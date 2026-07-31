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
   - `OPENROUTER_API_KEY` — para smoke/IA (`https://openrouter.ai/settings/keys`); opcional até ligar o pipeline

   Chaves em: Supabase Dashboard > Settings > API Keys. **Não deixe `SUPABASE_INTERNAL_URL=` vazio**
   — remova a linha ou deixe comentada para usar `NEXT_PUBLIC_SUPABASE_URL`.
   Fallback legado: `NEXT_PUBLIC_SUPABASE_ANON_KEY` (JWT).
2. **Web**:
   ```bash
   pnpm --filter @confere/web dev   # http://localhost:3000
   # ou: pnpm dev
   ```

### OpenRouter (IA)

- Client servidor: [`apps/web/src/lib/ai`](apps/web/src/lib/ai) — `createOpenRouter` + modelo `OPENROUTER_MODEL` (default `openai/gpt-5.6-luna`).
- Smoke autenticado: `GET /api/ai/health` (exige sessão Supabase).
- Chave **só no servidor** (`OPENROUTER_API_KEY`); nunca `NEXT_PUBLIC_*`.
- Pipeline de documentos (upload/classificação/extração) **ainda não** usa este client.

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
  - Bufferiza o body; **filtra** hop-by-hop (`content-encoding`, `transfer-encoding`, `set-cookie`, etc.)
  - Sem o filtro, o login na senha quebra com `Failed to fetch` (headers do Cloudflare)
- Destino: `SUPABASE_INTERNAL_URL` (se não vazio) → `NEXT_PUBLIC_SUPABASE_URL`
- Browser client usa `window.location.origin + "/supabase"` ([`apps/web/src/lib/supabase/client.ts`](apps/web/src/lib/supabase/client.ts))
- Server/middleware usam `NEXT_PUBLIC_SUPABASE_URL` diretamente
- Middleware ignora `/supabase` no matcher; limpa `sb-confere-auth-token*` se `getUser()` falhar
- Cookie de sessão com nome fixo `sb-confere-auth-token` nos três clientes (browser/server/middleware)
- `/api/auth/check-email` usa [`createSupabasePublicClient`](apps/web/src/lib/supabase/public-client.ts) (**sem cookies**)
  — evita JWT antigo (ex.: Supabase local) contaminar a RPC `email_registered`
- Publishable key: [`createSupabaseFetch`](apps/web/src/lib/supabase/fetch.ts) remove `Authorization: Bearer sb_publishable_...`
  (não é JWT; PostgREST responde `PGRST301` se enviada como Bearer)

### Estado atual do produto

| Área | Status |
|------|--------|
| Login / signup / logout | Funcional (cloud + publishable key) |
| Provisionamento automático de tenant | Funcional (trigger no signup) |
| Página `/analise` | UI pronta; upload é mock (sem backend) |
| Infra OpenRouter | Client + `/api/ai/health`; modelo default `openai/gpt-5.6-luna` |
| Pipeline de documentos (upload, IA, análise) | Não implementado |
| Testes automatizados | Nenhum (pacotes `domain` e `infrastructure` removidos) |

Detalhes e próximos passos: [`PLAN.md`](PLAN.md).

### Smoke check rápido

Com as chaves reais do projeto cloud:

```bash
# Defina KEY com NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY do .env
curl -s https://xmvypuwizexdhpwrgrao.supabase.co/auth/v1/health -H "apikey: $KEY"
curl -s http://localhost:3000/supabase/auth/v1/health -H "apikey: $KEY"
curl -sI http://localhost:3000/login | head -1
curl -s -X POST http://localhost:3000/api/auth/check-email \
  -H 'Content-Type: application/json' \
  -d '{"email":"teste@empresa.com"}'   # {"exists":false|true}
# OpenRouter (sessão autenticada + OPENROUTER_API_KEY):
# curl -s http://localhost:3000/api/ai/health --cookie 'sb-confere-auth-token=...'
```

### Cuidados não-óbvios

- **Não use Supabase CLI 2.110+** ao aplicar migrations (`db push`). O engine novo de migrations
  (effect/sql) quebra funções dollar-quoted e esconde o erro real do Postgres. Use versão estável
  (ex.: 2.34.3) para migrations.
- **Publishable key (`sb_publishable_...`)**: não é JWT. Sem `createSupabaseFetch`, o PostgREST
  responde `PGRST301` e a UI mostra "Erro ao verificar email".
- **Cookie JWT de outro projeto** (ex.: stack local antiga): quebra check-email/RPC com `PGRST301`.
  check-email ignora cookies; middleware limpa auth inválida. Hard refresh / limpar
  `sb-confere-auth-token*` se o browser ainda falhar.
- **Proxy `/supabase`**: não use rewrite do `next.config` (404 no App Router). O route handler
  deve filtrar hop-by-hop — senão "Failed to fetch" no login (senha).
- **`SUPABASE_INTERNAL_URL` vazio** quebra o proxy. Remova a linha ou deixe comentada.
- **`.env` é gitignored.** Next.js lê `apps/web/.env.local`; a raiz é usada para copiar para o app.
- **Grants RLS** (`private.*` → `authenticated`) são obrigatórios no cloud após o schema inicial.
- **OpenRouter**: `OPENROUTER_API_KEY` só no servidor; `/api/ai/health` retorna 503 se ausente e 401 sem sessão.
