# Confere.ia

Plataforma SaaS multi-tenant para gestão de importações com análise documental por IA.
Upload de Invoice, Packing List e Bill of Lading; extração automática de dados,
comparação de divergências, cadastro/validação de produtos e relatório de aprovação.

## Stack

- **Front-end / BFF**: Next.js 15 (App Router) + React 19 + Tailwind + shadcn/ui (`apps/web`)
- **Worker assíncrono**: Node.js + pg-boss sobre o Postgres do Supabase (`apps/worker`)
- **Banco / Auth / Storage**: Supabase (PostgreSQL com RLS em 100% das tabelas)
- **IA**: Google Gemini 3 Flash Preview atrás de um AI Gateway desacoplado (`packages/ai`)
- **Monorepo**: Turborepo + pnpm workspaces

## Estrutura

```
apps/
  web/        Next.js (UI + API routes / BFF)
  worker/     Consumidor da fila pg-boss (pipeline de processamento de IA)
packages/
  domain/           Entidades, value objects e regras de negócio puras
  application/      Casos de uso + ports (interfaces)
  ai/               AI Gateway: registry de capabilities, adapters, prompts, schemas
  database/         Schema Drizzle + client Postgres
  infrastructure/   Adapters: Supabase (storage/auth), pg-boss (fila), repositories
  config/           tsconfig e eslint compartilhados
supabase/
  migrations/       Schema + RLS + índices
  config.toml       Config do Supabase local
```

## Setup

Pré-requisitos: Node >= 20, pnpm 10, Docker (para Supabase local).

```bash
pnpm install
cp .env.example .env        # preencha as chaves
pnpm db:start               # sobe Supabase local (aplica migrations)
pnpm dev                    # web (3000) + worker
```

Comandos úteis:

```bash
pnpm typecheck   # typecheck de todos os pacotes
pnpm lint        # eslint
pnpm test        # vitest
pnpm build       # build de producao
pnpm db:migration <nome>   # cria nova migration
```

## Arquitetura de IA

Toda chamada de IA passa pelo gateway em `packages/ai`, que resolve
**capability -> provider/model** via `tenant_settings.ai_overrides` (fallback para env).
Para trocar de provedor, implemente o port `AIProvider` (`packages/application`)
e registre o adapter no gateway — nenhum caso de uso muda.

Capabilities: `ocr-extraction`, `document-comparison`, `product-matching`,
`ncm-classification`, `description-generation`, `validation-review`.

## Segurança

- RLS por `tenant_id` em todas as tabelas (claim em `app_metadata`, nunca `user_metadata`)
- Storage privado com signed URLs de curta duração
- `service_role` apenas no worker/BFF (nunca em variáveis `NEXT_PUBLIC_`)
- Auditoria com before/after em `audit_logs`
