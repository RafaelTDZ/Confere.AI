# Confere.ia

Plataforma SaaS multi-tenant. Nesta etapa o produto expõe autenticação (login/signup)
e a página protegida `/analise` (em construção).

## Stack

- **Front-end**: Next.js 15 (App Router) + React 19 + Tailwind + shadcn/ui (`apps/web`)
- **Banco / Auth**: Supabase (PostgreSQL com RLS)
- **Monorepo**: Turborepo + pnpm workspaces

## Estrutura

```
apps/
  web/        Next.js (UI + APIs de auth)
packages/
  config/     tsconfig e eslint compartilhados
supabase/
  migrations/ Schema + RLS + índices (auth/tenant)
  config.toml Config do Supabase local
```

## Setup

Pré-requisitos: Node >= 20, pnpm 10, Docker (para Supabase local).

```bash
pnpm install
cp .env.example .env        # preencha as chaves
pnpm db:start               # sobe Supabase local (aplica migrations)
pnpm dev                    # web em http://localhost:3000
```

Comandos úteis:

```bash
pnpm typecheck   # typecheck de todos os pacotes
pnpm lint        # eslint
pnpm test        # vitest (quando houver testes)
pnpm build       # build de producao
pnpm db:migration <nome>   # cria nova migration
```

## Segurança

- RLS por `tenant_id` em todas as tabelas (claim em `app_metadata`, nunca `user_metadata`)
- `service_role` apenas no servidor (nunca em variáveis `NEXT_PUBLIC_`)
