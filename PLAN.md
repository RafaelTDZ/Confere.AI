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
  - Proxy de refresh de sessão (`proxy.ts` + `@supabase/ssr`)
  - Cookie fixo `sb-confere-auth-token` (browser/server/proxy)
  - Proxy same-origin `/supabase` (route handler com filtro de headers hop-by-hop → Supabase cloud)
  - Chave pública: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_...`; fallback `ANON_KEY` legado)
  - check-email sem cookies de sessão; proxy limpa JWT inválido
- [x] **Multi-tenant**
  - Schema com RLS por `tenant_id` (claim em `app_metadata`)
  - Provisionamento automático no signup (trigger `on_auth_user_created`)
  - RPC `create_tenant_with_owner` como fallback (`ensureUserTenant`)
  - RPC `email_registered` para verificar email no login
- [x] **Shell autenticado**
  - Sidebar com Nova análise (`/analise`), Importações (`/importacoes`) e Produtos (`/produtos`)
  - Overlay mobile com menu abrível
- [x] **Página `/analise`**
  - Dropzone de upload ligada a `POST /api/ai/analyze` (202 + job na fila; worker classifica e extrai)
  - Cards "Como funciona" e "Documentos necessários"
  - Barra de progresso de documentos recebidos (atualizada pelos tipos classificados)
- [x] **Página `/importacoes`**
  - Lista `imports` do tenant com RLS (`getReadClient`); `service_role` só em escritas/jobs
- [x] **Página `/produtos`**
  - Placeholder (CRUD ainda não implementado)
- [x] **Migrations** — schema completo do domínio já criado no banco
- [x] **Documentação** — `README.md`, `AGENTS.md`, `.env.example`
- [x] **Infra OpenRouter** — client servidor (`apps/web/src/lib/ai`) + smoke autenticado `GET /api/ai/health` (modelo default `~openai/gpt-luna-latest`; validado com chave real)
- [x] **Upload + classificação + extração de chaves** — `POST /api/ai/analyze` enfileira (`ai_jobs`) e responde `202`; worker persiste `imports`/`documents` e extrai Invoice, número de Invoice explícito no Packing List e campos do BL

### Não implementado (UI ou backend)

- [ ] Extração de Packing List
- [ ] Extração de Bill of Lading
- [ ] Comparação entre documentos (regras de negócio)
- [ ] Tela de revisão de divergências
- [ ] CRUD de produtos
- [ ] Detalhe / revisão de importação
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

- [x] Pipeline OCR + LLM para Invoice (campos atuais: número, partes, produtos)
- [x] Persistir Invoice em `extraction_results` (+ confirmação `extractionResultId` na API)
- [ ] Expandir Invoice (valores, INCOTERM) e extrair BL (container, peso) / Packing List (volumes)

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
| Sem testes | Pacotes com testes foram removidos na simplificação; nenhum teste no `apps/web` |
| Grants RLS private.* | Migration `20250731190000_grant_private_rls_functions.sql` — aplicar no cloud se selects autenticados ainda falharem |

## Arquitetura atual

```
Browser
  │
  ├─ /login, /signup          → React (client + Supabase browser via /supabase proxy)
  ├─ /analise                 → React (sidebar + dropzone → /api/ai/analyze)
  ├─ /importacoes             → Server Component (lista via lib/documents)
  ├─ /produtos                → Placeholder catálogo
  ├─ /supabase/*              → Route handler (body bufferizado, headers filtrados) → Supabase cloud
  ├─ /api/auth/check-email    → Client público (sem cookies) → RPC email_registered
  ├─ /api/ai/health           → OpenRouter generateText (sessão obrigatória; chave só no servidor)
  └─ /api/ai/analyze          → cria job (202) → worker baixa o arquivo e roda classificação/extração

apps/web/src
  ├─ app/                     → Rotas e pages finas
  ├─ components/              → ui + auth + layout + analise
  └─ lib/                     → ai (providers/, tasks/), auth, documents, settings, supabase

Next.js proxy                  → refresh de sessão; limpa cookie se JWT inválido

Supabase cloud (`https://pavxbcsolcvekwslhzmf.supabase.co`)
  ├─ Auth (GoTrue)            → JWT com app_metadata.tenant_id
  ├─ PostgreSQL + RLS         → schema multi-tenant (private.* com GRANT a authenticated)
  ├─ Storage                  → bucket `import-documents` (pasta raiz = tenant_id)
  └─ Triggers                 → provisionamento automático de tenant no signup

OpenRouter                    → modelos ~openai/gpt-luna-latest e meta/muse-spark-1.3 (OPENROUTER_API_KEY)
```

## Referências

- [`README.md`](README.md) — setup, variáveis de ambiente, rotas
- [`AGENTS.md`](AGENTS.md) — instruções para agentes (auth)
- [`.env.example`](.env.example) — variáveis de ambiente
- [`supabase/migrations/`](supabase/migrations/) — schema do banco
