# Confere.ia

Plataforma SaaS multi-tenant para análise de documentos de importação com IA.
Nesta etapa o produto expõe autenticação (login/signup) e a página protegida `/analise`
(UI pronta; pipeline de upload e processamento ainda não conectado).

## Stack

| Camada | Tecnologia |
|--------|------------|
| Front-end | Next.js 15 (App Router) + React 19 + Tailwind + shadcn/ui |
| Banco / Auth | Supabase cloud (PostgreSQL com RLS) |
| IA | OpenRouter (`@openrouter/ai-sdk-provider`) via AI SDK; modelos `~openai/gpt-luna-latest` e `meta/muse-spark-1.3` (troca em `/configuracoes`) |
| Monorepo | Turborepo + pnpm workspaces |

## Estrutura

```
apps/
  web/              Next.js — UI, APIs de auth e página /analise
    src/
      app/          Rotas e pages finas ((auth), (app), api, supabase proxy)
      components/   ui (shadcn) + auth + layout + analise
      lib/          ai (providers/, tasks/), auth, documents, settings, supabase, utils
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
| `/configuracoes` | Super-admin (`ADMIN_EMAILS`) | Provedor e modelo de IA para todos os usuários + teste de conexão |
| `/api/auth/check-email` | Público | Verifica se email já está cadastrado |
| `/api/ai/health` | Autenticado | Smoke da integração de IA (`generateText` no provider ativo) |
| `/api/ai/analyze` | Autenticado | Upload + classificação de tipos + extração de Invoice |
| `/api/settings/ai` | Super-admin (`ADMIN_EMAILS`) | GET/PUT/DELETE da config global de IA (tabela `app_settings`, chave `ai`) |

## Setup local

Pré-requisitos: Node >= 20, pnpm 10. O projeto usa **Supabase cloud** — não é necessário Docker nem Supabase local.

### Passo a passo

```bash
pnpm install
cp .env.example .env
# Edite o .env na raiz e preencha (uma chave por linha):
#   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
#   OPENROUTER_API_KEY=sk-or-v1-...
#   SUPABASE_SERVICE_ROLE_KEY=...   # obrigatória para /api/ai/analyze
pnpm dev         # web em http://localhost:3000
```

O arquivo `.env` na raiz **não vem no repositório** (gitignored). O Next carrega esse arquivo via `apps/web/next.config.ts` — não é necessário `apps/web/.env.local`.

### Projeto Supabase

O projeto usa o Supabase cloud: `https://pavxbcsolcvekwslhzmf.supabase.co`.

As chaves publishable (`sb_publishable_...`) estão no dashboard: **Settings → API Keys**.
(Opcional legado: `anon` JWT em Legacy API Keys.)

`SUPABASE_INTERNAL_URL` deve ficar **removido ou comentado** no `.env` — string vazia quebra o proxy `/supabase`.

Variáveis já exportadas no shell/CI com valor **vazio** (ex.: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=`) **não são sobrescritas** pelo `.env` — remova-as do ambiente ou defina o valor real antes de `pnpm dev`.

### Migrations

Para aplicar ou criar migrations no projeto cloud:

```bash
supabase link --project-ref pavxbcsolcvekwslhzmf
supabase db push          # aplica supabase/migrations/
pnpm db:migration <nome>  # cria nova migration em supabase/migrations/
```

Requer Supabase CLI (qualquer versão recente compatível com `db push`).

### Smoke check

Com as chaves reais do projeto:

```bash
# Defina KEY com NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY do seu .env
curl -s https://pavxbcsolcvekwslhzmf.supabase.co/auth/v1/health -H "apikey: $KEY"  # JSON GoTrue
curl -s http://localhost:3000/supabase/auth/v1/health -H "apikey: $KEY"            # mesmo via proxy
curl -sI http://localhost:3000/login | head -1                                      # HTTP 200
curl -s -X POST http://localhost:3000/api/auth/check-email \
  -H 'Content-Type: application/json' \
  -d '{"email":"teste@empresa.com"}'                                                 # {"exists":...}
# OpenRouter (requer cookie de sessão autenticada + OPENROUTER_API_KEY):
# Faça login no browser em /login, depois:
curl -s http://localhost:3000/api/ai/health --cookie 'sb-confere-auth-token=...'
# Esperado: {"ok":true,"model":"~openai/gpt-luna-latest","text":"ok","latencyMs":...}
```

### Troubleshooting

| Problema | Causa provável | Solução |
|----------|----------------|---------|
| Não acho `.env` | Arquivo não está no git | `cp .env.example .env` e preencha as chaves |
| `Variáveis de ambiente Supabase não configuradas` | `.env` faltando, chave vazia, ou env do shell/CI com `NEXT_PUBLIC_*=` vazio sobrescrevendo o arquivo | Crie/preencha o `.env` na raiz; `unset` vars vazias no shell; reinicie o `pnpm dev` |
| `Invalid API key` no Auth | Publishable key colada na mesma linha do comentário `# NEXT_PUBLIC_SUPABASE_ANON_KEY=` | Deixe a key sozinha na linha; comente o anon em linha separada |
| `Erro ao verificar email` | JWT antigo no cookie (ex.: Supabase local) ou publishable key em `Authorization: Bearer` | Hard refresh / limpar `sb-confere-auth-token*`; `/api/auth/check-email` usa client sem sessão; ver `createSupabaseFetch` |
| `Failed to fetch` na senha (login/signup) | Proxy repassando headers hop-by-hop do Cloudflare, ou browser chamando Supabase direto | Confira route handler em `apps/web/src/app/supabase/[...path]/route.ts` (filtra `content-encoding` / `transfer-encoding` / `set-cookie`) |
| `/supabase/*` retorna 500 | `SUPABASE_INTERNAL_URL=` vazio no `.env` | Remova a linha ou comente — string vazia quebra o proxy |
| `/api/ai/health` → 401 | Sem sessão | Faça login antes; a rota exige cookie `sb-confere-auth-token` |
| `/api/ai/health` → 503 | `OPENROUTER_API_KEY` ausente | Preencha no `.env` da raiz e reinicie o Next |
| `/api/ai/analyze` → 503 (service role) | `SUPABASE_SERVICE_ROLE_KEY` ausente | Preencha a service role no `.env` (Dashboard → API Keys) |
| Login redireciona de volta ao `/login` | Cookie de sessão divergente | Cookie fixo `sb-confere-auth-token` em browser/server/middleware |
| `permission denied for function current_tenant_id` | Grants RLS ausentes no cloud | Aplique `20250731190000_grant_private_rls_functions.sql` (`db push` ou SQL Editor). O `/api/ai/analyze` já grava via service role e não depende desse grant |
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
| `NEXT_PUBLIC_SUPABASE_URL` | Sim | URL do projeto Supabase cloud (`https://pavxbcsolcvekwslhzmf.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Sim* | Chave publishable (`sb_publishable_...`). *Ou use `NEXT_PUBLIC_SUPABASE_ANON_KEY` (legado) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Não | JWT `anon` legado — fallback se publishable não estiver definida |
| `SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Sim* | Service role (servidor). *Obrigatória para `/api/ai/analyze` persistir `extraction_results` / `ai_logs` |
| `SUPABASE_INTERNAL_URL` | Não | Override do destino do proxy `/supabase` (padrão: `NEXT_PUBLIC_SUPABASE_URL`). **Não deixe vazio** — remova a linha ou use URL válida |
| `OPENROUTER_API_KEY` | Não* | Chave OpenRouter (servidor). *Obrigatória para IA (`/api/ai/health`, `/api/ai/analyze`) |
| `OPENROUTER_MODEL` | Não | Modelo OpenRouter (default: `meta/muse-spark-1.3`; alternativo: `~openai/gpt-luna-latest`) |
| `OPENROUTER_REASONING_EFFORT` | Não | Override de reasoning: `xhigh` \| `high` \| `medium` \| `low` \| `none` (padrão para análise: `low`) |
| `OPENROUTER_REASONING_MAX_TOKENS` | Não | Budget de tokens de reasoning (alternativa a `effort`; não usar os dois) |
| `OPENROUTER_REASONING_EXCLUDE` | Não | `true`/`false` — remove reasoning tokens da resposta |
| `SENTRY_DSN` | Não | Observabilidade |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Não | Observabilidade |

O Next.js lê o `.env` da raiz do monorepo. Migrations no projeto cloud são aplicadas com a CLI do Supabase (`supabase link` + `supabase db push`).

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
- **Auditoria**: `audit_logs`, `ai_logs` (tokens, `cost_usd`, `reasoning_tokens` e `import_id` por chamada de IA — para relatórios futuros)

Ver `PLAN.md` para o roadmap completo.

## Deploy (Vercel)

O monorepo usa `vercel.json` na raiz. Com **Root Directory** vazio (raiz do repo), o Vercel precisa de `next` também no `package.json` da raiz para detectar o framework; o build filtra `@confere/web` via Turborepo.

Adicione as variáveis (Production + Preview):

```
NEXT_PUBLIC_SUPABASE_URL=https://pavxbcsolcvekwslhzmf.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<sb_publishable_...>
SUPABASE_SERVICE_ROLE_KEY=<service_role>
OPENROUTER_API_KEY=<sk-or-v1-...>
OPENROUTER_MODEL=meta/muse-spark-1.3
```

O proxy `/supabase` segue automaticamente `NEXT_PUBLIC_SUPABASE_URL`. Use `SUPABASE_INTERNAL_URL` apenas se precisar de um destino diferente no servidor.

> Preferível a médio prazo: Root Directory = `apps/web` no dashboard (padrão Turborepo) e remover `next` da raiz.

## Segurança

- RLS por `tenant_id` em todas as tabelas (claim em `app_metadata`, nunca `user_metadata`)
- Funções `security definer` no schema `private` (não exposto via API)
- `service_role` apenas no servidor (nunca em variáveis `NEXT_PUBLIC_`)
