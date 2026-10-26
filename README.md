# Confere.ia

Plataforma SaaS multi-tenant para análise de documentos de importação com IA.
O produto tem autenticação (login/signup), a página `/analise` e o pipeline de
upload/processamento conectado: o upload vira um job na fila (`ai_jobs`), a IA
classifica e extrai Invoice/Packing List/BL e a UI acompanha o status.

## Stack

| Camada | Tecnologia |
|--------|------------|
| Front-end | Next.js 15 (App Router) + React 19 + Tailwind + shadcn/ui |
| Banco / Auth | Supabase cloud (PostgreSQL com RLS) |
| IA | Fireworks (`@ai-sdk/fireworks`) como padrão — `accounts/fireworks/routers/deepseek-flash-latest` / `glm-flash-latest` (PDF convertido em imagens); OpenRouter (`@openrouter/ai-sdk-provider`) como opção com `~openai/gpt-luna-latest` / `meta/muse-spark-1.3`; troca em `/configuracoes` |
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
| `/empresas` | Protegido | Empresas do tenant (consignee/notify cadastrados pelas análises) |
| `/configuracoes` | Super-admin (`ADMIN_EMAILS`) | Consignee padrão do tenant + provedor/modelo de IA global |
| `/api/auth/check-email` | Público | Verifica se email já está cadastrado |
| `/api/ai/health` | Autenticado | Smoke da integração de IA (`generateText` no provider ativo) |
| `/api/ai/analyze` | Autenticado | Enfileira o upload e responde `202` com `jobId` (classificação/extração em background) |
| `/api/ai/jobs/[jobId]` | Autenticado | Status do job (`queued`/`running`/`succeeded`/`failed`) + `importId` |
| `/api/ai/jobs/run` | `CRON_SECRET` | Drena a fila de jobs (retry/cron do Vercel) |
| `/api/settings/ai` | Super-admin (`ADMIN_EMAILS`) | GET/PUT/DELETE da config global de IA (tabela `app_settings`, chave `ai`) |
| `/api/settings/consignee` | Owner/admin | PUT do consignee padrão do tenant (`partyId` ou `null`) |
| `/admin` | Super-admin (`ADMIN_EMAILS`) | Painel global somente leitura: tenants, contadores e uso de IA |
| `/admin/[tenantId]` | Super-admin (`ADMIN_EMAILS`) | Detalhe read-only do tenant (importações, empresas, NCMs, `ai_logs`); acesso auditado |

## Setup local

Pré-requisitos: Node >= 22.13, pnpm 10. O projeto usa **Supabase cloud** — não é necessário Docker nem Supabase local.

### Passo a passo

```bash
pnpm install
cp .env.example .env
# Edite o .env na raiz e preencha (uma chave por linha):
#   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
#   FIREWORKS_API_KEY=fw_...        # provedor padrão de IA
#   OPENROUTER_API_KEY=sk-or-v1-... # opcional (provider alternativo)
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
# IA (requer cookie de sessão autenticada + chave do provider ativo):
# Faça login no browser em /login, depois:
curl -s http://localhost:3000/api/ai/health --cookie 'sb-confere-auth-token=...'
# Esperado: {"ok":true,"provider":"fireworks","model":"accounts/fireworks/routers/deepseek-flash-latest",...}
# (provider/model = config global ou AI_PROVIDER/FIREWORKS_MODEL/OPENROUTER_MODEL)
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
| `/api/ai/health` → 503 | Chave do provider ativo ausente (`FIREWORKS_API_KEY` ou `OPENROUTER_API_KEY`) | Preencha no `.env` da raiz e reinicie o Next |
| `/api/ai/analyze` → 503 (service role) | `SUPABASE_SERVICE_ROLE_KEY` ausente | Preencha a service role no `.env` (Dashboard → API Keys) |
| Job de análise falha com erro de PDF | Fireworks não aceita PDF e a conversão passou dos limites (30 páginas/~7 MB) | Selecione OpenRouter em `/configuracoes` ou envie o documento como PNG/JPG |
| `/api/ai/analyze` → 429 | Rate limit por tenant ou quota mensal de tokens atingida | Ajuste `AI_ANALYZE_RATE_LIMIT` / `AI_MONTHLY_TOKEN_QUOTA` ou aguarde a janela/mês |
| Login redireciona de volta ao `/login` | Cookie de sessão divergente | Cookie fixo `sb-confere-auth-token` em browser/server/proxy |
| `permission denied for function current_tenant_id` | Grants RLS ausentes no cloud | Aplique `20250731190000_grant_private_rls_functions.sql` (`db push` ou SQL Editor). O `/api/ai/analyze` já grava via service role e não depende desse grant |
| Migrations / RPC `email_registered` missing | Banco cloud sem o schema | `supabase link` + `supabase db push` |

Detalhes para agentes: [`AGENTS.md`](AGENTS.md).

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
| `OPENROUTER_API_KEY` | Não* | Chave OpenRouter (servidor). *Obrigatória só quando `provider=openrouter` |
| `OPENROUTER_MODEL` | Não | Modelo OpenRouter (default: `~openai/gpt-luna-latest`; alternativo: `meta/muse-spark-1.3`) |
| `AI_PROVIDER` | Não | Provider padrão do servidor quando `app_settings` está vazio: `fireworks` (default) ou `openrouter` |
| `FIREWORKS_API_KEY` | Sim* | Chave Fireworks (servidor). *Obrigatória quando `provider=fireworks` (padrão) |
| `FIREWORKS_MODEL` | Não | Modelo Fireworks (default: `accounts/fireworks/routers/deepseek-flash-latest`; alternativa: `accounts/fireworks/routers/glm-flash-latest`) |
| `OPENROUTER_REASONING_EFFORT` | Não | Override de reasoning: `xhigh` \| `high` \| `medium` \| `low` \| `none` (padrão para análise: `low`) |
| `OPENROUTER_REASONING_MAX_TOKENS` | Não | Budget de tokens de reasoning (alternativa a `effort`; não usar os dois) |
| `OPENROUTER_REASONING_EXCLUDE` | Não | `true`/`false` — remove reasoning tokens da resposta |
| `AI_ANALYZE_RATE_LIMIT` / `AI_ANALYZE_RATE_WINDOW_SECONDS` | Não | Rate limit por tenant no `/api/ai/analyze` (default: 30 req / 3600 s) |
| `AI_MONTHLY_TOKEN_QUOTA` | Não | Quota mensal de tokens de IA por tenant (default: 10.000.000) |
| `CRON_SECRET` | Não* | Segredo de `POST/GET /api/ai/jobs/run` (`Authorization: Bearer`). *Sem ele o endpoint responde 503; jobs órfãos só rodam via `after()` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Não | Exporta traces/métricas para um coletor OTLP fora da Vercel (na Vercel usa a observabilidade do projeto) |
| `CHECK_EMAIL_RATE_LIMIT` / `CHECK_EMAIL_RATE_WINDOW_SECONDS` | Não | Rate limit por IP no `/api/auth/check-email` (default: 10 req / 60 s) |

O Next.js lê o `.env` da raiz do monorepo. Migrations no projeto cloud são aplicadas com a CLI do Supabase (`supabase link` + `supabase db push`).

## Auth

- **Login em 2 etapas**: `/api/auth/check-email` chama RPC `email_registered` com client **público** (sem cookies); se o email existir, pede senha; senão redireciona para signup.
- **Signup**: cria conta no Supabase Auth; trigger `on_auth_user_created` provisiona tenant, membro (owner) e settings automaticamente.
- **Sessão**: cookie fixo `sb-confere-auth-token` compartilhado entre browser, server e proxy. O proxy limpa o cookie se `getUser()` falhar (JWT de outro projeto).
- **Proxy same-origin**: o browser chama `/supabase/*` via route handler em `apps/web/src/app/supabase/[...path]/route.ts` (bufferiza o body e filtra headers hop-by-hop). Destino: `SUPABASE_INTERNAL_URL` → `NEXT_PUBLIC_SUPABASE_URL`.
- **Publishable key**: use `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_...`). `createSupabaseFetch` evita enviá-la em `Authorization: Bearer` (não é JWT).
- **Claims**: `tenant_id` e `tenant_role` em `app_metadata` (nunca `user_metadata`).
- **Fronteira server/client**: módulos com `import "server-only"` (Supabase admin/server, `lib/documents`, `lib/ai`, auth, security, settings) não podem ser importados por componentes client; a superfície client-safe é `*-shared.ts` + `lib/supabase/client`.
- **Observabilidade**: `apps/web/src/instrumentation.ts` registra `@vercel/otel`; `lib/observability/tracing.ts` cria spans do pipeline (`ai.analyze`, `ai.job`, `ai.classify`, `ai.extract_*`, `ai.persist_extraction`) e métricas por capability. Local/testes são no-op; na Vercel os traces vão para a observabilidade do projeto.

## Banco de dados

Schema multi-tenant com RLS em todas as tabelas. O app usa:

- **Auth/tenant**: `tenants`, `tenant_members`, `tenant_settings`
- **Domínio**: `imports`, `documents`, `extraction_results`, `parties`, `ncms` (leitura via RLS; escritas administrativas via service role)
- **Produto (futuro)**: `products`, `analysis_results`, `product_matches`
- **Fila de IA**: `ai_jobs` (upload enfileirado, status e erro; RLS de leitura por tenant)
- **Auditoria**: `audit_logs`, `ai_logs` (tokens, `cost_usd`, `reasoning_tokens` e `import_id` quando a chamada está ligada a uma importação)

Os tipos do schema ficam em `apps/web/src/lib/supabase/database.types.ts` (gerado do cloud e usado em `SupabaseClient<Database>`); regenere após aplicar migrations.

Ver `PLAN.md` para o roadmap completo.

## Deploy (Vercel)

O monorepo usa `vercel.json` na raiz. Com **Root Directory** vazio (raiz do repo), o Vercel precisa de `next` também no `package.json` da raiz para detectar o framework; o build filtra `@confere/web` via Turborepo.

Adicione as variáveis (Production + Preview):

```
NEXT_PUBLIC_SUPABASE_URL=https://pavxbcsolcvekwslhzmf.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<sb_publishable_...>
SUPABASE_SERVICE_ROLE_KEY=<service_role>
FIREWORKS_API_KEY=<fw_...>
AI_PROVIDER=fireworks
FIREWORKS_MODEL=accounts/fireworks/routers/deepseek-flash-latest
OPENROUTER_API_KEY=<sk-or-v1-...>   # opcional (provider alternativo)
OPENROUTER_MODEL=~openai/gpt-luna-latest
```

A migration `20261026142326_ai_fireworks_default.sql` já está aplicada no cloud e a config global aponta para Fireworks; **configure `FIREWORKS_API_KEY` na Vercel antes do deploy** (sem ela, health e análises respondem 503/502). Para voltar ao OpenRouter, troque em `/configuracoes`.

O proxy `/supabase` segue automaticamente `NEXT_PUBLIC_SUPABASE_URL`. Use `SUPABASE_INTERNAL_URL` apenas se precisar de um destino diferente no servidor.

> Root Directory = `apps/web` no dashboard (padrão Turborepo) segue opcional; `next` e `typescript` permanecem na raiz por causa do preview do v0.

## Segurança

- RLS por `tenant_id` em todas as tabelas (claim em `app_metadata`, nunca `user_metadata`)
- Funções `security definer` no schema `private` (não exposto via API)
- `service_role` apenas no servidor (nunca em variáveis `NEXT_PUBLIC_`)
