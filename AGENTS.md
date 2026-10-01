# AGENTS.md

## Cursor Cloud specific instructions

Confere.ia é um monorepo pnpm + Turborepo (web + Supabase cloud).
Comandos padrão (lint/typecheck/test/build/dev) estão no `README.md` e no `package.json` raiz — use-os.
Roadmap e estado do produto: `PLAN.md`.

### Serviços

- **Supabase cloud**: `https://xmvypuwizexdhpwrgrao.supabase.co` — fornece DB e Auth.
- **Web** (`apps/web`, Next.js): `http://localhost:3000`. Login/signup; app com sidebar (`/analise`, `/importacoes`, `/produtos`).

### Como rodar (sem Docker)

O projeto usa apenas Supabase cloud — não é necessário Docker, rede IPv6 ou `supabase start`.

1. **Configurar variáveis de ambiente**:
   ```bash
   pnpm install
   cp .env.example .env
   ```
   Edite o `.env` na raiz e preencha (**uma chave por linha**):
   - `NEXT_PUBLIC_SUPABASE_URL=https://xmvypuwizexdhpwrgrao.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — chave publishable (`sb_publishable_...`)
   - `OPENROUTER_API_KEY` — para smoke/IA (`https://openrouter.ai/settings/keys`); opcional até ligar o pipeline

   Chaves em: Supabase Dashboard > Settings > API Keys. **Não deixe `SUPABASE_INTERNAL_URL=` vazio**
   — remova a linha ou deixe comentada para usar `NEXT_PUBLIC_SUPABASE_URL`.
   Fallback legado: `NEXT_PUBLIC_SUPABASE_ANON_KEY` (JWT).

   O Next carrega o `.env` da raiz via `apps/web/next.config.ts` — não use `apps/web/.env.local`.

   **Env vazio no processo ganha do arquivo:** se o shell/CI exportar
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=` (string vazia), o Next **não** aplica o valor
   do `.env`. Faça `unset` da variável ou defina o valor real antes do `pnpm dev`.
2. **Web**:
   ```bash
   pnpm --filter @confere/web dev   # http://localhost:3000
   # ou: pnpm dev
   ```

### OpenRouter (IA)

- Client servidor: [`apps/web/src/lib/ai`](apps/web/src/lib/ai) — `createOpenRouter` + modelo `OPENROUTER_MODEL` (default `~openai/gpt-luna-latest`).
- Smoke autenticado: `GET /api/ai/health` (exige sessão Supabase).
  - Sem cookie → `401`; sem `OPENROUTER_API_KEY` → `503`; sucesso → `{ ok, model, text, latencyMs }`.
- Análise de documento: `POST /api/ai/analyze` (multipart `file`).
  - Classifica tipos (`invoice` / `packing_list` / `bill_of_lading`; multi-tipo permitido).
  - Se houver Invoice, extrai número, exportador, importador, notify e produtos.
  - Persiste Storage `import-documents` + `imports`/`documents`; `extraction_results`/`ai_logs` via **service role**.
- Chaves só no servidor: `OPENROUTER_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (nunca `NEXT_PUBLIC_*`).
- Packing List: extração limitada ao número de Invoice, quando explicitamente indicado.
- BL: extrai campos próprios do conhecimento e empresas; não fornece número de Invoice.

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
| Página `/analise` | Dropzone → `/api/ai/analyze` (Storage + classify + extract Invoice persistido) |
| Página `/importacoes` | Lista `imports` do tenant (admin + tenant_id do JWT) |
| Página `/produtos` | Placeholder (CRUD pendente) |
| Shell autenticado | Sidebar: Nova análise, Importações, Produtos |
| Infra OpenRouter | Client + `/api/ai/health`; modelo default `~openai/gpt-luna-latest` |
| Classificação + extração | `/api/ai/analyze`; Invoice e número da Invoice no PL em `extraction_results`; BL sem número da Invoice |
| Pipeline completo (extração integral de PL, comparação) | Não implementado |
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
# OpenRouter (sessão autenticada + OPENROUTER_API_KEY no .env da raiz):
# curl -s http://localhost:3000/api/ai/health --cookie 'sb-confere-auth-token=...'
# → {"ok":true,"model":"~openai/gpt-luna-latest","text":"ok","latencyMs":...}
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
- **`.env` na raiz é gitignored.** Não vem no clone — copie de `.env.example`.
  O Next carrega só o `.env` da raiz (`apps/web/next.config.ts`); não use `apps/web/.env.local`.
- **Não cole a publishable key na mesma linha do comentário** `# NEXT_PUBLIC_SUPABASE_ANON_KEY=`
  (vira `Invalid API key`).
- **Env vazio no processo** (`NEXT_PUBLIC_*=`) impede o `.env` de preencher a chave.
- **Grants RLS** (`private.*` → `authenticated`) são obrigatórios no cloud após o schema inicial.
- **OpenRouter**: `OPENROUTER_API_KEY` só no servidor; `/api/ai/health` retorna 503 se ausente e 401 sem sessão.
- **Service role**: `SUPABASE_SERVICE_ROLE_KEY` obrigatória para `/api/ai/analyze`
  (grava Storage/`imports`/`documents`/`extraction_results`/`ai_logs` via admin;
  tenant_id sempre do JWT). Evita `permission denied for function current_tenant_id`
  quando os grants de `private.*` ainda não foram aplicados no cloud.
- **Grants RLS** (recomendado): rode
  [`20250731190000_grant_private_rls_functions.sql`](supabase/migrations/20250731190000_grant_private_rls_functions.sql)
  no SQL Editor para selects autenticados com policies RLS funcionarem.
