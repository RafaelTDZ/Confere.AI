# Confere.ia

Plataforma SaaS multi-tenant para análise de documentos de importação com IA.
Nesta etapa o produto expõe autenticação (login/signup) e a página protegida `/analise`
(UI pronta; pipeline de upload e processamento ainda não conectado).

## Stack

| Camada | Tecnologia |
|--------|------------|
| Front-end | Next.js 15 (App Router) + React 19 + Tailwind + shadcn/ui |
| Banco / Auth | Supabase cloud (PostgreSQL com RLS) |
| IA | OpenRouter (`@openrouter/ai-sdk-provider` + AI SDK); modelo default `openai/gpt-5.6-luna` |
| Monorepo | Turborepo + pnpm workspaces |

## Estrutura

```
apps/
  web/              Next.js — UI, APIs de auth e página /analise
packages/
  config/           tsconfig e eslint compartilhados
supabase/
  migrations/       Schema multi-tenant + RLS + triggers de auth
  config.toml       Config do Supabase CLI (link ao projeto cloud)
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
| `/api/ai/health` | Autenticado | Smoke da integração OpenRouter (`generateText`) |

## Setup local

Pré-requisitos: Node >= 20, pnpm 10. O projeto usa **Supabase cloud** — não é necessário Docker nem Supabase local.

### Passo a passo

```bash
pnpm install
cp .env.example .env
cp .env apps/web/.env.local
# Preencha NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
# (Dashboard > Settings > API Keys — sb_publishable_...)
# Opcional para smoke de IA: OPENROUTER_API_KEY (openrouter.ai/settings/keys)
pnpm dev         # web em http://localhost:3000
```

### Projeto Supabase

O projeto usa o Supabase cloud: `https://xmvypuwizexdhpwrgrao.supabase.co`.

As chaves publishable (`sb_publishable_...`) estão no dashboard: **Settings → API Keys**.
(Opcional legado: `anon` JWT em Legacy API Keys.)

`SUPABASE_INTERNAL_URL` deve ficar **removido ou comentado** no `.env` — string vazia quebra o proxy `/supabase`.

### Migrations

Para aplicar ou criar migrations no projeto cloud:

```bash
supabase link --project-ref xmvypuwizexdhpwrgrao
supabase db push          # aplica supabase/migrations/
pnpm db:migration <nome>  # cria nova migration em supabase/migrations/
```

Requer Supabase CLI (qualquer versão recente compatível com `db push`).

### Smoke check

Com as chaves reais do projeto:

```bash
# Defina KEY com NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY do seu .env
curl -s https://xmvypuwizexdhpwrgrao.supabase.co/auth/v1/health -H "apikey: $KEY"  # JSON GoTrue
curl -s http://localhost:3000/supabase/auth/v1/health -H "apikey: $KEY"            # mesmo via proxy
curl -sI http://localhost:3000/login | head -1                                      # HTTP 200
curl -s -X POST http://localhost:3000/api/auth/check-email \
  -H 'Content-Type: application/json' \
  -d '{"email":"teste@empresa.com"}'                                                 # {"exists":...}
# OpenRouter (requer cookie de sessão autenticada + OPENROUTER_API_KEY):
# curl -s http://localhost:3000/api/ai/health --cookie 'sb-confere-auth-token=...'  # {"ok":true,"model":"openai/gpt-5.6-luna",...}
```

### Troubleshooting

| Problema | Causa provável | Solução |
|----------|----------------|---------|
| `Variáveis de ambiente Supabase não configuradas` | `.env.local` faltando ou sem chaves | Copie `.env.example` para `.env` e `apps/web/.env.local`; preencha `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| `Erro ao verificar email` | JWT antigo no cookie (ex.: Supabase local) ou publishable key em `Authorization: Bearer` | Hard refresh / limpar `sb-confere-auth-token*`; `/api/auth/check-email` usa client sem sessão; ver `createSupabaseFetch` |
| `Failed to fetch` na senha (login/signup) | Proxy repassando headers hop-by-hop do Cloudflare, ou browser chamando Supabase direto | Confira route handler em `apps/web/src/app/supabase/[...path]/route.ts` (filtra `content-encoding` / `transfer-encoding` / `set-cookie`) |
| `/supabase/*` retorna 500 | `SUPABASE_INTERNAL_URL=` vazio no `.env` | Remova a linha ou comente — string vazia quebra o proxy |
| Login redireciona de volta ao `/login` | Cookie de sessão divergente | Cookie fixo `sb-confere-auth-token` em browser/server/middleware |
| `permission denied for function current_tenant_id` | Grants RLS ausentes no cloud | Aplique `20250731190000_grant_private_rls_functions.sql` (`db push` ou SQL Editor) |
| Migrations / RPC `email_registered` missing | Banco cloud sem o schema | `supabase link` + `supabase db push` |

Detalhes para agentes (Cursor Cloud): [`AGENTS.md`](AGENTS.md).

Comandos úteis:

```bash
pnpm typecheck   # typecheck de todos os pacotes
pnpm lint        # eslint
pnpm build       # build de produção
pnpm db:migration <nome>   # cria nova migration
```

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Sim | URL do projeto Supabase cloud (`https://xmvypuwizexdhpwrgrao.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Sim* | Chave publishable (`sb_publishable_...`). *Ou use `NEXT_PUBLIC_SUPABASE_ANON_KEY` (legado) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Não | JWT `anon` legado — fallback se publishable não estiver definida |
| `SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Não | Chave secreta / service_role (apenas servidor; app atual não usa) |
| `SUPABASE_INTERNAL_URL` | Não | Override do destino do proxy `/supabase` (padrão: `NEXT_PUBLIC_SUPABASE_URL`). **Não deixe vazio** — remova a linha ou use URL válida |
| `OPENROUTER_API_KEY` | Não* | Chave OpenRouter (servidor). *Obrigatória para `/api/ai/health` e futuras chamadas de IA |
| `OPENROUTER_MODEL` | Não | Modelo OpenRouter (default: `openai/gpt-5.6-luna`) |
| `SENTRY_DSN` | Não | Observabilidade |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Não | Observabilidade |

O Next.js lê `apps/web/.env.local`. Migrations no projeto cloud são aplicadas com a CLI do Supabase (`supabase link` + `supabase db push`).

## Auth

- **Login em 2 etapas**: `/api/auth/check-email` chama RPC `email_registered` com client **público** (sem cookies); se o email existir, pede senha; senão redireciona para signup.
- **Signup**: cria conta no Supabase Auth; trigger `on_auth_user_created` provisiona tenant, membro (owner) e settings automaticamente.
- **Sessão**: cookie fixo `sb-confere-auth-token` compartilhado entre browser, server e middleware. Middleware limpa o cookie se `getUser()` falhar (JWT de outro projeto).
- **Proxy same-origin**: o browser chama `/supabase/*` via route handler em `apps/web/src/app/supabase/[...path]/route.ts` (bufferiza o body e filtra headers hop-by-hop). Destino: `SUPABASE_INTERNAL_URL` → `NEXT_PUBLIC_SUPABASE_URL`.
- **Publishable key**: use `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_...`). `createSupabaseFetch` evita enviá-la em `Authorization: Bearer` (não é JWT).
- **Claims**: `tenant_id` e `tenant_role` em `app_metadata` (nunca `user_metadata`).

## Banco de dados

Schema multi-tenant com RLS em todas as tabelas. Tabelas de domínio já existem nas migrations, mas a UI ainda não as utiliza:

- **Auth/tenant**: `tenants`, `tenant_members`, `tenant_settings`
- **Domínio** (futuro): `products`, `imports`, `documents`, `extraction_results`, `analysis_results`, `product_matches`
- **Auditoria**: `audit_logs`, `ai_logs`

Ver `PLAN.md` para o roadmap completo.

## Deploy

Configure as variáveis no ambiente de deploy (Vercel, etc.):

```
NEXT_PUBLIC_SUPABASE_URL=https://xmvypuwizexdhpwrgrao.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<sb_publishable_...>
OPENROUTER_API_KEY=<sk-or-v1-...>
OPENROUTER_MODEL=openai/gpt-5.6-luna
```

O proxy `/supabase` segue automaticamente `NEXT_PUBLIC_SUPABASE_URL`. Use `SUPABASE_INTERNAL_URL` apenas se precisar de um destino diferente no servidor.

## Segurança

- RLS por `tenant_id` em todas as tabelas (claim em `app_metadata`, nunca `user_metadata`)
- Funções `security definer` no schema `private` (não exposto via API)
- `service_role` apenas no servidor (nunca em variáveis `NEXT_PUBLIC_`)
