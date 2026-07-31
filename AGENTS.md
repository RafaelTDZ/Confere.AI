# AGENTS.md

## Cursor Cloud specific instructions

Confere.ia é um monorepo pnpm + Turborepo (web + Supabase local).
Comandos padrão (lint/typecheck/test/build/dev) estão no `README.md` e no `package.json` raiz — use-os.
Roadmap e estado do produto: `PLAN.md`.

### Serviços

- **Supabase local** (Docker): Postgres 54322, API 54321, Studio 54323. Fornece DB e Auth.
- **Web** (`apps/web`, Next.js): `http://localhost:3000`. Login/signup e página `/analise`.

### Como subir o ambiente (ordem importa)

Registro do que foi necessário para rodar neste ambiente (jul/2026). O passo a passo completo
com troubleshooting está no [`README.md`](README.md).

1. **Docker** precisa estar rodando antes do Supabase. O daemon não sobe sozinho no boot:
   ```bash
   sudo mkdir -p /etc/docker
   # Preferir overlay2; se falhar ao iniciar dockerd, usar vfs:
   echo '{"storage-driver":"overlay2","ipv6":true,"fixed-cidr-v6":"fd00:dead:beef::/48"}' \
     | sudo tee /etc/docker/daemon.json
   sudo dockerd &
   # Erros comuns ao subir dockerd:
   #   fuse-overlayfs: executable file not found → use overlay2 ou vfs
   #   overlay2: driver not supported → use vfs
   # Se trocar o driver, edite daemon.json e reinicie dockerd.
   sudo chmod 666 /var/run/docker.sock   # se permission denied no socket
   ```
2. **Corrigir IPv4 entre containers** (obrigatório neste host — sem isso Auth/Kong travam):
   ```bash
   sudo sysctl -w net.bridge.bridge-nf-call-iptables=0
   sudo sysctl -w net.bridge.bridge-nf-call-ip6tables=0
   # persistir:
   # echo -e 'net.bridge.bridge-nf-call-iptables=0\nnet.bridge.bridge-nf-call-ip6tables=0' \
   #   | sudo tee /etc/sysctl.d/99-docker-bridge.conf
   ```
3. **Supabase CLI 2.x estável** (ex.: **2.34.3**), **NÃO 2.110+**. Se não estiver instalada:
   ```bash
   curl -fsSL https://github.com/supabase/cli/releases/download/v2.34.3/supabase_linux_amd64.tar.gz \
     | sudo tar -xz -C /usr/local/bin supabase
   ```
4. **Rede Docker com IPv6** antes do `supabase start` (o Realtime inicia com `ECTO_IPV6=true`
   e falha em rede só-IPv4):
   ```bash
   docker network rm supabase_network_confere-ia 2>/dev/null || true
   # Se a bridge já usa fd00:dead:beef::/48, NÃO use fd00:dead:beef:1::/64
   # (Pool overlaps). Use subnet IPv6 fora desse range:
   docker network create --ipv6 \
     --subnet=172.19.0.0/16 --gateway=172.19.0.1 \
     --subnet=fc01:2345:6789::/64 --gateway=fc01:2345:6789::1 \
     supabase_network_confere-ia
   NET_ID=$(docker network inspect supabase_network_confere-ia -f '{{.Id}}')
   supabase start --network-id "$NET_ID" \
     -x logflare -x vector -x imgproxy -x storage-api \
     --ignore-health-check
   ```
   Storage não é necessário para login + `/analise`. Se Auth ficar `unhealthy` com
   `connection refused` em `:9999`, confira o sysctl do passo 2 e reinicie o container
   `supabase_auth_confere-ia`.
5. **`.env`** na raiz (e `apps/web/.env.local` para o Next). Chaves locais são determinísticas:
   ```bash
   cp .env.example .env
   # preencha com as JWT demo (sempre as mesmas no Supabase local):
   # NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
   # NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
   # SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU
   cp .env apps/web/.env.local
   ```
   **Não deixe `SUPABASE_INTERNAL_URL=` vazio** — string vazia quebra o proxy `/supabase`.
   Remova a linha ou deixe comentada para usar `NEXT_PUBLIC_SUPABASE_URL`.
6. **Web**:
   ```bash
   pnpm install
   pnpm --filter @confere/web dev   # http://localhost:3000
   # ou: pnpm dev
   ```

### Auth no browser (importante)

O client browser **não** chama o Supabase direto (falha com `Failed to fetch` em
preview/túnel remoto). O Next faz proxy same-origin:

- Route handler: `/supabase/:path*` → upstream Supabase ([`apps/web/src/app/supabase/[...path]/route.ts`](apps/web/src/app/supabase/[...path]/route.ts))
- Destino: `SUPABASE_INTERNAL_URL` (se não vazio) → `NEXT_PUBLIC_SUPABASE_URL` → `http://127.0.0.1:54321`
- Browser client usa `window.location.origin + "/supabase"` ([`apps/web/src/lib/supabase/client.ts`](apps/web/src/lib/supabase/client.ts))
- Server/middleware usam `NEXT_PUBLIC_SUPABASE_URL` diretamente
- Middleware ignora `/supabase` no matcher (não refresca sessão em requests de API)
- Cookie de sessão com nome fixo `sb-confere-auth-token` nos três clientes (browser/server/middleware),
  senão o storageKey diverge (hostname do proxy vs `127.0.0.1`) e `/analise` redireciona de volta ao login.

Em produção, `NEXT_PUBLIC_SUPABASE_URL` aponta para o Supabase hospedado e o proxy segue
automaticamente — não é necessário hardcodar a URL no código.

### Estado atual do produto

| Área | Status |
|------|--------|
| Login / signup / logout | Funcional |
| Provisionamento automático de tenant | Funcional (trigger no signup) |
| Página `/analise` | UI pronta; upload é mock (sem backend) |
| Pipeline de documentos (upload, IA, análise) | Não implementado |
| Testes automatizados | Nenhum (pacotes `domain` e `infrastructure` removidos) |

Detalhes e próximos passos: [`PLAN.md`](PLAN.md).

### Smoke check rápido

```bash
ANON='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
curl -s http://127.0.0.1:54321/auth/v1/health -H "apikey: $ANON"           # JSON do GoTrue
curl -s http://127.0.0.1:3000/supabase/auth/v1/health -H "apikey: $ANON"   # mesmo via proxy
curl -sI http://127.0.0.1:3000/login | head -1                             # HTTP 200
curl -sI http://127.0.0.1:3000/ | grep -i location                         # redirect /login
```

### Cuidados não-óbvios

- **Não use Supabase CLI 2.110+.** O engine novo de migrations (effect/sql) quebra funções
  dollar-quoted e esconde o erro real do Postgres.
- **Docker storage driver**: neste host, `fuse-overlayfs` e `overlay2` falharam; `vfs` funcionou.
  Tente `overlay2` primeiro em máquinas normais; use `vfs` como fallback.
- **IPv4 quebrado na bridge** (`ping` entre containers falha, IPv6 funciona): quase sempre
  `net.bridge.bridge-nf-call-iptables=1`. Zere conforme o passo 2.
- **Subnet IPv6 conflitante**: se `docker network create` retorna `Pool overlaps`, a bridge
  já cobre o range (ex.: `fd00:dead:beef::/48`). Use outro prefixo (ex.: `fc01:2345:6789::/64`).
- **Realtime "Initialising schema" / pool timeout**: rede sem IPv6 enquanto o container usa
  `ECTO_IPV6=true`. Pré-crie a network IPv6 e passe `--network-id`.
- **`supabase start` pode matar o stack** se um healthcheck HTTP estourar timeout (ex.: storage).
  Use `-x storage-api` e `--ignore-health-check` quando o objetivo for só auth + web.
- **Proxy `/supabase`**: rewrite em `next.config.ts` não funcionou no App Router (404).
  Substituído por route handler; não remover sem testar login no browser.
- **`.env` é gitignored.** Next.js lê `apps/web/.env.local`; o script raiz `pnpm db:*` usa a CLI
  do Supabase, não o `.env` do app.
