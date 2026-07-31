# AGENTS.md

## Cursor Cloud specific instructions

Confere.ia é um monorepo pnpm + Turborepo (web + Supabase cloud).
Comandos padrão (lint/typecheck/test/build/dev) estão no `README.md` e no `package.json` raiz — use-os.
Roadmap e estado do produto: `PLAN.md`.

### Serviços

- **Supabase cloud**: `https://xmvypuwizexdhpwrgrao.supabase.co` — fornece DB e Auth.
- **Web** (`apps/web`, Next.js): `http://localhost:3000`. Login/signup e página `/analise`.

### Como rodar (sem Docker)

O projeto usa apenas Supabase cloud — não é necessário Docker, rede IPv6 ou `supabase start`.

1. **Configurar variáveis de ambiente**:
   ```bash
   pnpm install
   cp .env.example .env
   cp .env apps/web/.env.local
   ```
   Edite `.env` e `apps/web/.env.local` e preencha:
   - `NEXT_PUBLIC_SUPABASE_URL=https://xmvypuwizexdhpwrgrao.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — chave publishable (`sb_publishable_...`)

   Chaves em: Supabase Dashboard > Settings > API Keys. **Não deixe `SUPABASE_INTERNAL_URL=` vazio**
   — remova a linha ou deixe comentada para usar `NEXT_PUBLIC_SUPABASE_URL`.
   Fallback legado: `NEXT_PUBLIC_SUPABASE_ANON_KEY` (JWT).
2. **Web**:
   ```bash
   pnpm --filter @confere/web dev   # http://localhost:3000
   # ou: pnpm dev
   ```

### Migrations no cloud

Para aplicar ou criar migrations no projeto hospedado:

```bash
supabase link --project-ref xmvypuwizexdhpwrgrao
supabase db push          # aplica supabase/migrations/
pnpm db:migration <nome>  # cria nova migration em supabase/migrations/
```

**RLS / grants:** a migration `20250731190000_grant_private_rls_functions.sql` concede
`EXECUTE` nas funções `private.*` para `authenticated`. Sem ela, selects autenticados
falham com `permission denied for function current_tenant_id`. Se não puder usar a CLI,
cole o SQL dessa migration no **SQL Editor** do dashboard e execute.

### Auth no browser (importante)

O client browser **não** chama o Supabase direto (falha com `Failed to fetch` em
preview/túnel remoto). O Next faz proxy same-origin:

- Route handler: `/supabase/:path*` → upstream Supabase ([`apps/web/src/app/supabase/[...path]/route.ts`](apps/web/src/app/supabase/[...path]/route.ts))
- Destino: `SUPABASE_INTERNAL_URL` (se não vazio) → `NEXT_PUBLIC_SUPABASE_URL`
- Browser client usa `window.location.origin + "/supabase"` ([`apps/web/src/lib/supabase/client.ts`](apps/web/src/lib/supabase/client.ts))
- Server/middleware usam `NEXT_PUBLIC_SUPABASE_URL` diretamente
- Middleware ignora `/supabase` no matcher (não refresca sessão em requests de API)
- Cookie de sessão com nome fixo `sb-confere-auth-token` nos três clientes (browser/server/middleware),
  senão o storageKey diverge (hostname do proxy vs URL direta) e `/analise` redireciona de volta ao login.

Como o projeto já está na cloud, `NEXT_PUBLIC_SUPABASE_URL` é a URL de produção em dev e deploy —
o proxy segue automaticamente, sem hardcode.

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

Com as chaves reais do projeto cloud:

```bash
# Defina ANON com NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY do .env
curl -s https://xmvypuwizexdhpwrgrao.supabase.co/auth/v1/health -H "apikey: $ANON"  # JSON do GoTrue
curl -s http://localhost:3000/supabase/auth/v1/health -H "apikey: $ANON"              # mesmo via proxy
curl -sI http://localhost:3000/login | head -1                                       # HTTP 200
curl -sI http://localhost:3000/ | grep -i location                                   # redirect /login
```

### Cuidados não-óbvios

- **Não use Supabase CLI 2.110+** ao aplicar migrations (`db push`). O engine novo de migrations
  (effect/sql) quebra funções dollar-quoted e esconde o erro real do Postgres. Use versão estável
  (ex.: 2.34.3) para migrations.
- **Publishable key (`sb_publishable_...`)**: não é JWT. O `supabase-js` enviava a key
  em `Authorization: Bearer`, e o PostgREST respondia `PGRST301` ("Erro ao verificar email").
  Corrigido com `createSupabaseFetch` em [`apps/web/src/lib/supabase/fetch.ts`](apps/web/src/lib/supabase/fetch.ts)
  (remove Authorization quando o Bearer é a própria API key opaca).
- **Proxy `/supabase`**: rewrite em `next.config.ts` não funcionou no App Router (404).
  Substituído por route handler; não remover sem testar login no browser.
- **`SUPABASE_INTERNAL_URL` vazio** quebra o proxy. Remova a linha ou deixe comentada.
- **`.env` é gitignored.** Next.js lê `apps/web/.env.local`; a raiz é usada para copiar para o app.
