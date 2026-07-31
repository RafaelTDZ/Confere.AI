# Confere.ia

Plataforma SaaS multi-tenant para análise de documentos de importação com IA.
Nesta etapa o produto expõe autenticação (login/signup) e a página protegida `/analise`
(UI pronta; pipeline de upload e processamento ainda não conectado).

## Stack

| Camada | Tecnologia |
|--------|------------|
| Front-end | Next.js 15 (App Router) + React 19 + Tailwind + shadcn/ui |
| Banco / Auth | Supabase (PostgreSQL com RLS) |
| Monorepo | Turborepo + pnpm workspaces |

## Estrutura

```
apps/
  web/              Next.js — UI, APIs de auth e página /analise
packages/
  config/           tsconfig e eslint compartilhados
supabase/
  migrations/       Schema multi-tenant + RLS + triggers de auth
  config.toml       Config do Supabase local
```

## Rotas

| Rota | Acesso | Descrição |
|------|--------|-----------|
| `/` | Público | Redireciona para `/analise` (autenticado) ou `/login` |
| `/login` | Público | Login em 2 etapas (email → senha) |
| `/signup` | Público | Cadastro com nome, email e senha |
| `/analise` | Protegido | Nova análise de importação (dropzone + orientações) |
| `/api/auth/check-email` | Público | Verifica se email já está cadastrado |
| `/api/auth/save-user-info` | Autenticado | Atualiza nome/empresa do membro (legado) |

## Setup local

Pré-requisitos: Node >= 20, pnpm 10, Docker (para Supabase local), Supabase CLI **2.34.3** (evite 2.110+).

### Passo a passo rápido

```bash
pnpm install
cp .env.example .env
cp .env apps/web/.env.local
# Preencha NEXT_PUBLIC_SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY
# (chaves demo do Supabase local — ver seção abaixo)
pnpm db:start    # sobe Supabase local e aplica migrations
pnpm dev         # web em http://localhost:3000
```

### Chaves JWT do Supabase local

O Supabase local usa chaves determinísticas (sempre as mesmas):

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU
```

Deixe `SUPABASE_INTERNAL_URL` **vazio ou removido** no `.env`. Uma string vazia quebra o proxy `/supabase` (o route handler precisa de URL válida ou cai no fallback).

### Docker + Supabase (ordem importa)

Em ambientes Linux sem systemd (VM cloud, CI), o daemon Docker pode não estar rodando. Suba antes do Supabase:

```bash
# 1. Configurar daemon (IPv6 obrigatório para Realtime)
sudo mkdir -p /etc/docker
# Tente overlay2; se falhar, use vfs (comum em VMs sem overlay mount)
echo '{"storage-driver":"overlay2","ipv6":true,"fixed-cidr-v6":"fd00:dead:beef::/48"}' \
  | sudo tee /etc/docker/daemon.json
sudo dockerd &
# Se overlay2 falhar: troque storage-driver para "vfs" e reinicie dockerd
sudo chmod 666 /var/run/docker.sock   # se permission denied no socket

# 2. IPv4 entre containers (Auth/Kong travam sem isso em alguns hosts)
sudo sysctl -w net.bridge.bridge-nf-call-iptables=0
sudo sysctl -w net.bridge.bridge-nf-call-ip6tables=0

# 3. Instalar Supabase CLI 2.34.3 (NÃO 2.110+)
curl -fsSL https://github.com/supabase/cli/releases/download/v2.34.3/supabase_linux_amd64.tar.gz \
  | sudo tar -xz -C /usr/local/bin supabase

# 4. Rede Docker com IPv6 antes do supabase start
docker network rm supabase_network_confere-ia 2>/dev/null || true
docker network create --ipv6 \
  --subnet=172.19.0.0/16 --gateway=172.19.0.1 \
  --subnet=fc01:2345:6789::/64 --gateway=fc01:2345:6789::1 \
  supabase_network_confere-ia
NET_ID=$(docker network inspect supabase_network_confere-ia -f '{{.Id}}')
supabase start --network-id "$NET_ID" \
  -x logflare -x vector -x imgproxy -x storage-api \
  --ignore-health-check
```

Storage não é necessário para login + `/analise`. Se Auth ficar `unhealthy` com `connection refused` em `:9999`, confira o sysctl e reinicie `supabase_auth_confere-ia`.

### URLs após subir

| Serviço | URL |
|---------|-----|
| Web | http://localhost:3000 |
| Supabase API | http://127.0.0.1:54321 |
| Supabase Studio | http://127.0.0.1:54323 |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |

### Smoke check

```bash
ANON='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
curl -s http://127.0.0.1:54321/auth/v1/health -H "apikey: $ANON"    # JSON GoTrue
curl -s http://127.0.0.1:3000/supabase/auth/v1/health -H "apikey: $ANON"  # mesmo via proxy
curl -sI http://127.0.0.1:3000/login | head -1                       # HTTP 200
curl -sI http://127.0.0.1:3000/ | grep -i location                    # redirect /login
```

### Troubleshooting

| Problema | Causa provável | Solução |
|----------|----------------|---------|
| `docker: command not found` | Docker não instalado | `sudo apt-get install -y docker.io` |
| `fuse-overlayfs: executable file not found` | Driver recomendado indisponível | Use `storage-driver: vfs` em `/etc/docker/daemon.json` |
| `overlay2: driver not supported` | Host sem overlay mount | Idem — use `vfs` |
| `Pool overlaps with other one` ao criar rede | Subnet IPv6 conflita com bridge | Use subnet diferente (ex.: `fc01:2345:6789::/64`) |
| Realtime "Initialising schema" / pool timeout | Rede sem IPv6 | Pré-crie network IPv6 e passe `--network-id` |
| Auth `unhealthy`, `connection refused :9999` | Bridge IPv4 quebrada | Zere `net.bridge.bridge-nf-call-iptables` |
| `/supabase/*` retorna 404 ou 500 | Proxy quebrado ou env inválido | Confira `SUPABASE_INTERNAL_URL` vazio; route handler em `apps/web/src/app/supabase/[...path]/route.ts` |
| Login redireciona de volta ao `/login` | Cookie de sessão divergente | Cookie fixo `sb-confere-auth-token` em browser/server/middleware |

Detalhes adicionais para Cursor Cloud e agentes: [`AGENTS.md`](AGENTS.md).

Comandos úteis:

```bash
pnpm typecheck   # typecheck de todos os pacotes
pnpm lint        # eslint
pnpm build       # build de produção
pnpm db:migration <nome>   # cria nova migration
pnpm db:reset    # recria o banco local
```

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Sim | URL do Supabase (`http://127.0.0.1:54321` local; `https://<ref>.supabase.co` em produção) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Sim | Chave anon do Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Sim | Chave service role (apenas servidor) |
| `SUPABASE_INTERNAL_URL` | Não | Override do destino do proxy `/supabase` (padrão: `NEXT_PUBLIC_SUPABASE_URL`). **Não deixe vazio** — remova a linha ou use URL válida |
| `SENTRY_DSN` | Não | Observabilidade |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Não | Observabilidade |

O Next.js lê `apps/web/.env.local`. O script `pnpm db:*` usa a CLI do Supabase.

## Auth

- **Login em 2 etapas**: verifica email via RPC `email_registered`; se existir, pede senha; senão redireciona para signup.
- **Signup**: cria conta no Supabase Auth; trigger `on_auth_user_created` provisiona tenant, membro (owner) e settings automaticamente.
- **Sessão**: cookie fixo `sb-confere-auth-token` compartilhado entre browser, server e middleware.
- **Proxy same-origin**: o browser chama `/supabase/*` via route handler em `apps/web/src/app/supabase/[...path]/route.ts`; o destino segue `SUPABASE_INTERNAL_URL` → `NEXT_PUBLIC_SUPABASE_URL`. Necessário para preview/túnel remoto e produção.
- **Claims**: `tenant_id` e `tenant_role` em `app_metadata` (nunca `user_metadata`).

## Banco de dados

Schema multi-tenant com RLS em todas as tabelas. Tabelas de domínio já existem nas migrations, mas a UI ainda não as utiliza:

- **Auth/tenant**: `tenants`, `tenant_members`, `tenant_settings`
- **Domínio** (futuro): `products`, `imports`, `documents`, `extraction_results`, `analysis_results`, `product_matches`
- **Auditoria**: `audit_logs`, `ai_logs`

Ver `PLAN.md` para o roadmap completo.

## Deploy

Em produção, configure no ambiente de deploy:

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

O proxy `/supabase` segue automaticamente `NEXT_PUBLIC_SUPABASE_URL`. Use `SUPABASE_INTERNAL_URL` apenas se precisar de um destino diferente no servidor.

## Segurança

- RLS por `tenant_id` em todas as tabelas (claim em `app_metadata`, nunca `user_metadata`)
- Funções `security definer` no schema `private` (não exposto via API)
- `service_role` apenas no servidor (nunca em variáveis `NEXT_PUBLIC_`)
