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

Pré-requisitos: Node >= 20, pnpm 10, Docker (para Supabase local).

```bash
pnpm install
cp .env.example .env
cp .env apps/web/.env.local
# Preencha NEXT_PUBLIC_SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY
# (chaves demo do Supabase local — ver AGENTS.md)
pnpm db:start    # sobe Supabase local e aplica migrations
pnpm dev         # web em http://localhost:3000
```

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
| `SUPABASE_INTERNAL_URL` | Não | Override do destino do proxy `/supabase` (padrão: `NEXT_PUBLIC_SUPABASE_URL`) |
| `SENTRY_DSN` | Não | Observabilidade |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Não | Observabilidade |

O Next.js lê `apps/web/.env.local`. O script `pnpm db:*` usa a CLI do Supabase.

## Auth

- **Login em 2 etapas**: verifica email via RPC `email_registered`; se existir, pede senha; senão redireciona para signup.
- **Signup**: cria conta no Supabase Auth; trigger `on_auth_user_created` provisiona tenant, membro (owner) e settings automaticamente.
- **Sessão**: cookie fixo `sb-confere-auth-token` compartilhado entre browser, server e middleware.
- **Proxy same-origin**: o browser chama `/supabase/*` (rewrite do Next); o destino segue `NEXT_PUBLIC_SUPABASE_URL`. Necessário para preview/túnel remoto e produção.
- **Claims**: `tenant_id` e `tenant_role` em `app_metadata` (nunca `user_metadata`).

## Banco de dados

Schema multi-tenant com RLS em todas as tabelas. Tabelas de domínio já existem nas migrations, mas a UI ainda não as utiliza:

- **Auth/tenant**: `tenants`, `tenant_members`, `tenant_settings`
- **Domínio** (futuro): `products`, `imports`, `documents`, `extraction_results`, `analysis_results`, `product_matches`
- **Auditoria**: `audit_logs`, `ai_logs`

Ver `plan.md` para o roadmap completo.

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
