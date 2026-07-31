# Plano — Confere.ia

Roadmap e estado atual do produto. Atualizado em jul/2026.

## Visão

Confere.ia é uma plataforma SaaS multi-tenant que analisa documentos de importação
(Invoice, Bill of Lading, Packing List) com IA: classifica, extrai dados e aponta
divergências entre documentos.

## Estado atual

### Entregue

- [x] **Monorepo simplificado** — apenas `apps/web` + `packages/config` (pacotes `domain` e `infrastructure` removidos)
- [x] **Auth completo**
  - Login em 2 etapas (verifica email → senha)
  - Signup com nome, email e senha
  - Logout
  - Middleware de refresh de sessão (`@supabase/ssr`)
  - Cookie fixo `sb-confere-auth-token` (browser/server/middleware)
  - Proxy same-origin `/supabase` (route handler com filtro de headers hop-by-hop → Supabase cloud)
  - Chave pública: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_...`; fallback `ANON_KEY` legado)
  - check-email sem cookies de sessão; middleware limpa JWT inválido
- [x] **Multi-tenant**
  - Schema com RLS por `tenant_id` (claim em `app_metadata`)
  - Provisionamento automático no signup (trigger `on_auth_user_created`)
  - RPC `create_tenant_with_owner` como fallback (`ensureUserTenant`)
  - RPC `email_registered` para verificar email no login
- [x] **Página `/analise`**
  - Layout autenticado (header com email + logout)
  - Dropzone de upload (UI only — mock de 600ms)
  - Cards "Como funciona" e "Documentos necessários"
  - Barra de progresso de documentos recebidos (estática)
- [x] **Migrations** — schema completo do domínio já criado no banco
- [x] **Documentação** — `README.md`, `AGENTS.md`, `.env.example`
- [x] **Infra OpenRouter** — client servidor (`apps/web/src/lib/ai`) + smoke autenticado `GET /api/ai/health` (modelo default `openai/gpt-5.6-luna`; validado com chave real); pipeline de documentos ainda não ligado

### Não implementado (UI ou backend)

- [ ] Upload real de arquivos (Supabase Storage ou S3)
- [ ] Classificação de documentos com IA
- [ ] Extração de dados (OCR + LLM)
- [ ] Comparação entre documentos (regras de negócio)
- [ ] Tela de revisão de divergências
- [ ] CRUD de produtos
- [ ] Histórico de análises
- [ ] Testes automatizados
- [ ] Observabilidade (Sentry/OTEL configuráveis mas não integrados)

## Schema do banco (existente, aguardando uso)

| Tabela | Propósito |
|--------|-----------|
| `tenants` | Empresas (multi-tenant) |
| `tenant_members` | Membros com role (owner/admin/member/viewer) |
| `tenant_settings` | Configurações por tenant |
| `products` | Catálogo de produtos do tenant |
| `imports` | Importações (agrupamento de documentos) |
| `documents` | Arquivos enviados (invoice, BL, packing list) |
| `extraction_results` | Dados extraídos por documento |
| `analysis_results` | Resultado da comparação entre documentos |
| `product_matches` | Match produto extraído ↔ catálogo |
| `audit_logs` | Auditoria de ações |
| `ai_logs` | Logs de chamadas à IA |

Funções auxiliares no schema `private`: `current_tenant_id()`, `current_role()`, `is_tenant_member()`, `has_tenant_role()`.

## Fases planejadas

### Fase 1 — Upload e armazenamento

- Conectar dropzone ao Supabase Storage (ou provider externo)
- Criar registro em `imports` e `documents` no upload
- Validar tipo/tamanho de arquivo (PDF, PNG, JPG)
- Atualizar barra de progresso com documentos reais

### Fase 2 — Classificação com IA

- Enviar documento para modelo de visão (classificar: invoice, BL, packing list)
- Atualizar `documents.type` com resultado
- Feedback visual na dropzone (badges de tipo identificado)

### Fase 3 — Extração de dados

- Pipeline OCR + LLM para extrair campos estruturados
- Persistir em `extraction_results`
- Suportar Invoice (itens, valores, INCOTERM), BL (container, peso) e Packing List (volumes)

### Fase 4 — Comparação e análise

- Regras de negócio: cruzar quantidades, valores, pesos entre documentos
- Persistir divergências em `analysis_results`
- Match de produtos extraídos com catálogo (`product_matches`)

### Fase 5 — Revisão e histórico

- Tela de revisão com divergências apontadas
- Aprovação/rejeição da análise
- Listagem de análises anteriores por tenant
- Dashboard com métricas básicas

### Fase 6 — Qualidade e operação

- Reintroduzir testes (unitários para regras de negócio, integração para auth)
- Integrar Sentry e OpenTelemetry
- CI/CD com lint, typecheck, build e testes
- Reavaliar reintrodução de `packages/domain` e `packages/infrastructure` conforme complexidade

## Dívida técnica conhecida

| Item | Detalhe |
|------|---------|
| `/api/auth/save-user-info` | Lê `tenant_id` de `user_metadata` em vez de `app_metadata` — rota legada, provavelmente não usada |
| Sem testes | Pacotes com testes foram removidos na simplificação; nenhum teste no `apps/web` |
| Upload mock | `upload-dropzone.tsx` simula delay de 600ms sem persistir arquivo |
| Grants RLS private.* | Migration `20250731190000_grant_private_rls_functions.sql` — aplicar no cloud se selects autenticados ainda falharem |

## Arquitetura atual

```
Browser
  │
  ├─ /login, /signup          → React (client + Supabase browser via /supabase proxy)
  ├─ /analise                 → React (server layout + client dropzone)
  ├─ /supabase/*              → Route handler (body bufferizado, headers filtrados) → Supabase cloud
  ├─ /api/auth/check-email    → Client público (sem cookies) → RPC email_registered
  └─ /api/ai/health           → OpenRouter generateText (sessão obrigatória; chave só no servidor)

Next.js middleware             → refresh de sessão; limpa cookie se JWT inválido

Supabase cloud (`https://xmvypuwizexdhpwrgrao.supabase.co`)
  ├─ Auth (GoTrue)            → JWT com app_metadata.tenant_id
  ├─ PostgreSQL + RLS         → schema multi-tenant (private.* com GRANT a authenticated)
  └─ Triggers                 → provisionamento automático de tenant no signup

OpenRouter                    → modelo default openai/gpt-5.6-luna (OPENROUTER_API_KEY)
```

## Referências

- [`README.md`](README.md) — setup, variáveis de ambiente, rotas
- [`AGENTS.md`](AGENTS.md) — instruções para agentes (Cursor Cloud, auth)
- [`.env.example`](.env.example) — variáveis de ambiente
- [`supabase/migrations/`](supabase/migrations/) — schema do banco
