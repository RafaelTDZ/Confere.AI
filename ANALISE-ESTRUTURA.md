# Análise da estrutura — Confere.ia

> Documento de diagnóstico e plano de correção.
>
> **Data:** 21/10/2026
> **Base analisada:** commit `82f1944` + alterações locais ainda não commitadas (15 arquivos) + 2 migrations não rastreadas.
> **Escopo:** `apps/web`, `packages/config`, `supabase/migrations`, CI, documentação e configuração de ambiente.
> **Método:** leitura do código, `typecheck`, `lint`, `build`, `test`, health check read-only no Supabase e inspeção do schema via REST.
> **Nenhum arquivo de código foi alterado durante a análise.** Este documento é o único artefato criado.
>
> **Atualização 23/10/2026:** ENV-01 e ENV-02 corrigidos — `README.md`, `AGENTS.md`, `PLAN.md`, `.env.example`, `package.json` e o MCP do OpenCode agora apontam para `pavxbcsolcvekwslhzmf`. O `.cursor/mcp.json` foi removido (Cursor não é mais usado). As referências ao ref antigo abaixo permanecem como registro histórico.
>
> **Atualização 26/10/2026 (status dos achados):** 20 concluídos (ENV-02, OPS-01, OPS-02, DOC-01, DX-01, DEP-01, SEC-02, QUA-01, AI-02, SEC-01, OBS-01, ENV-01, OBS-02, SEC-03, PERF-01, DATA-02, DATA-01, AI-01, DATA-03, OBS-03), 1 parcial (OPS-03) e nenhum em aberto. Migrations: 23/23 aplicadas no cloud (última `20261026142326`); `app_settings` com `provider=fireworks` e `model=accounts/fireworks/routers/deepseek-flash-latest`. Decisões: `next`/`typescript` ficam na raiz por causa do preview do v0; a suíte foi reiniciada com Vitest (699 testes; `documents` 94,35% e `ai` 100% de lines) e o pipeline vazio foi removido. Cada achado abaixo traz o status atualizado.

---

## 1. Sumário executivo

O Confere.ia tem uma base **boa para um MVP**: monorepo enxuto, Next.js App Router com rotas relativamente finas, separação razoável entre UI, acesso a dados e integração de IA, e preocupação real com multi-tenant, RLS e segredos no servidor.

Os principais riscos não estão na organização das pastas, mas em **operação e confiabilidade**:

1. **Referências do Supabase divergentes** entre documentação, `.env` local e MCP ativo.
2. **Nenhum teste automatizado**, mas o CI passa mesmo assim.
3. **Pipeline de IA síncrono, caro e sujeito a timeout** — resolvido em out/2026 com a fila `ai_jobs` + `202 Accepted`.
4. **Uso amplo de `service_role` para leitura**, com isolamento por tenant feito manualmente.
5. **Operações compostas sem transação** e risco de duplicidade em importações.
6. **Tipos do banco não gerados**, permitindo divergências entre schema e TypeScript.
7. **Documentação desatualizada** em relação ao código atual.

### 1.1 Nota crítica de ambiente

Há **três referências de projeto Supabase** em jogo:

| Fonte | Project ref | Situação |
|---|---|---|
| `README.md`, `AGENTS.md`, `PLAN.md`, `.env.example` | `xmvypuwizexdhpwrgrao` | **DNS não resolve** — projeto inexistente ou removido |
| `.env` local (gitignored) | `pavxbcsolcvekwslhzmf` | **Ativo** — Auth responde 200 e o schema do Confere.ia existe |
| MCP Supabase ativo nesta sessão | `bsczvemaqvladupmdpgl` | **Outro projeto** — migrations de `excel_imports`, sem relação com este app |

O `.cursor/mcp.json` do repositório apontava para `pavxbcsolcvekwslhzmf` (arquivo removido em 23/10/2026, pois o Cursor não é mais usado); a divergência do MCP, portanto, era específica da configuração do ambiente de execução. De qualquer forma, **não use o MCP atual para aplicar migrations neste repositório** antes de alinhar a conexão.

**Impacto:** qualquer pessoa seguindo o README configura um projeto inexistente; `supabase link --project-ref xmvypuwizexdhpwrgrao` falha; ferramentas MCP podem aplicar migrations no banco errado.

---

## 2. Stack e dimensões

| Item | Valor |
|---|---|
| Framework | Next.js 15.5.22 + React 19.2.8 |
| IA | AI SDK 7.0.46 + `@openrouter/ai-sdk-provider` 3.0.0 |
| Banco/Auth | Supabase (`@supabase/supabase-js` 2.111.0, `@supabase/ssr` 0.5.2) |
| Validação | Zod 3.25.76 |
| Monorepo | pnpm 10 + Turborepo 2.10.7 |
| Código-fonte | 84 arquivos TS/TSX em `apps/web/src` (~270 KB) |
| Banco | 19 migrations |
| Build | 24 rotas; First Load JS entre 103 kB e 179 kB |
| Node declarado | `>=22.12` na raiz (alinhado em out/2026 com o provider e o Vitest) |

---

## 3. Estrutura atual

```text
Confere.ia/
├─ apps/
│  └─ web/                          # único app deployável
│     └─ src/
│        ├─ app/
│        │  ├─ (auth)/              # login, signup
│        │  ├─ (app)/               # shell autenticado
│        │  │  ├─ analise/          # upload + cadastro de partes
│        │  │  ├─ importacoes/      # lista + detalhe
│        │  │  ├─ empresas/         # consignee/notify
│        │  │  ├─ ncm/              # catálogo NCM
│        │  │  ├─ produtos/         # placeholder
│        │  │  └─ configuracoes/    # admin de IA
│        │  ├─ api/                 # ai, auth, imports, parties, ncms, settings
│        │  └─ supabase/            # proxy same-origin para o Supabase
│        ├─ components/             # ui + componentes por domínio
│        ├─ lib/
│        │  ├─ ai/                  # provider, schemas, tasks
│        │  ├─ documents/           # imports, documents, parties, ncms, storage, pipeline
│        │  ├─ auth/
│        │  ├─ settings/
│        │  └─ supabase/            # clients browser/server/admin + fetch
│        └─ proxy.ts                # refresh/limpeza de sessão (Next 16)
├─ packages/config/                 # tsconfig e eslint compartilhados
├─ supabase/migrations/             # schema multi-tenant + RLS
├─ .github/workflows/ci.yml
├─ turbo.json / pnpm-workspace.yaml / vercel.json
└─ README.md / AGENTS.md / PLAN.md
```

Existe também um `apps/worker/` local, **não rastreado pelo git**, contendo apenas `node_modules` e `.turbo` de pacotes já removidos (`@confere/domain`, `@confere/application`, `@confere/infrastructure` etc.). Era resíduo de workspace; foi apagado em 23/10/2026 (OPS-01).

---

## 4. Arquitetura e fluxo principal

```text
UI (app/ + components/)
   │
   ├─ Server Components / Route Handlers
   │      ├─ lib/auth        → valida JWT e extrai tenant_id/role
   │      ├─ lib/documents   → imports, documents, parties, ncms, pipeline
   │      │      └─ Supabase admin client (service_role)
   │      └─ lib/ai          → classificação + extração → OpenRouter
   │
   └─ Browser → /supabase proxy → Supabase Auth/PostgREST
```

### 4.1 Fluxo de análise de documento

```text
Upload (multipart)
  → POST /api/ai/analyze
  → getAuthContext() (JWT + tenant_id + role)
  → runAnalyzePipeline()
      → valida tipo/tamanho (PDF/PNG/JPG/WEBP, máx. 10 MB)
      → calcula SHA-256
      → classifyDocument()            [1 chamada de IA]
      → extractInvoice()              [se invoice]
      → extractPackingList()          [se packing_list]
      → extractBl()                   [se bill_of_lading]
      → findOrCreateImport()          [invoice_number / bl_number / supplier]
      → findDocumentsBySha256()       [dedupe tardio]
      → upload Storage + insert documents
      → persistExtractionResult()
      → updateDocumentStatus()
      → updateImportStatus(awaiting_review)
      → resolveInvoiceParties() / resolveBlParties()
  → redireciona para /analise/[importId]/partes ou /importacoes/[importId]
```

### 4.2 Multi-tenant

- `tenant_id` e `tenant_role` ficam em `app_metadata` do JWT (nunca `user_metadata`).
- Trigger `on_auth_user_created` provisiona tenant, membro owner e settings no signup.
- Funções `private.current_tenant_id()`, `private.current_role()`, `private.is_tenant_member()` e `private.has_tenant_role()` sustentam as policies de RLS.
- Bucket `import-documents` é privado, com pasta raiz igual ao `tenant_id`.
- `service_role` é usado no servidor para upload/persistência e, por enquanto, também para leituras.

---

## 5. Pontos fortes

- **Monorepo simples e funcional**: apenas `apps/web` + `packages/config`; sem pacotes cerimoniais.
- **Rotas finas**: a lógica relevante está em `lib/`, não nas pages/route handlers.
- **Boa separação da IA**: `lib/ai/providers`, `lib/ai/tasks` e `lib/ai/schemas` com Zod.
- **Módulos `*-shared.ts`** isolam tipos/constantes usados por componentes client, evitando importar código server-only no browser.
- **Segurança pensada desde o schema**: RLS por tenant, funções `security definer` em schema privado, claims em `app_metadata`, bucket privado.
- **Proxy same-origin `/supabase`** resolve o problema de browser → Supabase em preview/túnel remoto.
- **Segredos apenas no servidor**: `service_role` e `OPENROUTER_API_KEY` não usam `NEXT_PUBLIC_*`.
- **Admin de IA global** protegido por allowlist `ADMIN_EMAILS`, negado por padrão quando vazia.
- **Validação de upload** com limite de 10 MB e tipos permitidos.
- **Build, lint e typecheck limpos** no estado atual.
- **Documentação de troubleshooting** acima da média para um MVP.

---

## 6. Saúde verificada

| Verificação | Comando | Resultado |
|---|---|---|
| Typecheck | `pnpm --filter @confere/web typecheck` | ✅ passou |
| Lint | `pnpm --filter @confere/web lint` | ✅ passou |
| Build | `pnpm build` | ✅ passou em ~1m04, 26 rotas |
| Testes | `pnpm test` | ✅ 622 testes em 37 arquivos (Vitest 5.0.5) |
| Cobertura | `pnpm test:coverage` | Global 95,43% lines; `documents` 94,31% (gate 88%); `ai` 100% (gate 98%) |

### 6.1 Versões instaladas relevantes

```text
next@15.5.22
react@19.2.8
ai@7.0.46
@openrouter/ai-sdk-provider@3.0.0
@supabase/supabase-js@2.111.0
@supabase/ssr@0.5.2
zod@3.25.76
```

### 6.2 Rotas no build

```text
/                                  /
/analise                           /analise/[importId]/partes
/importacoes                       /importacoes/[id]
/empresas                          /empresas/[id]
/ncm                               /ncm/nova
/ncm/[id]                          /produtos
/configuracoes                     /login
/signup                            /supabase/[...path]
/api/ai/analyze                    /api/ai/health
/api/auth/check-email              /api/imports/[id]
/api/imports/[id]/parties          /api/ncms
/api/ncms/[id]                     /api/parties/[id]
/api/settings/ai
```

First Load JS: 103 kB (rotas simples) a 179 kB (`/login` e `/signup`). Middleware: 92,3 kB.

---

## 7. Achados detalhados

Legenda de severidade:

- **P0** — bloqueia onboarding/deploy com segurança; corrigir antes de avançar.
- **P1** — risco alto de custo, segurança, perda de dados ou indisponibilidade.
- **P2** — dívida relevante de manutenibilidade/observabilidade.
- **P3** — limpeza e melhorias incrementais.

### ENV-01 — Referências do Supabase divergentes (P0)

**Evidência:**

- `README.md:66`, `AGENTS.md:11`, `.env.example:4` e `PLAN.md:144` usam `xmvypuwizexdhpwrgrao`.
- `.env` local (gitignored) usa `pavxbcsolcvekwslhzmf`.
- Health check read-only: `pavx...` responde **200**; `xmvy...` **não resolve DNS**.
- Schema confirmado em `pavx...`: `imports`, `documents`, `tenants`, `app_settings`, `parties`, `ncms`, `ai_logs`.

**Impacto:** setup quebrado para novos desenvolvedores; `supabase link`/`db push` apontando para projeto inexistente.

**Correção proposta:**

- [x] Atualizar `README.md`, `AGENTS.md`, `PLAN.md` e `.env.example` para `pavxbcsolcvekwslhzmf`.
- [x] Adicionar um preflight no CI que valide o project ref esperado.
- [x] Documentar que o `.env` é local e não versionado.

**Critério de aceite:** `grep` não encontra mais `xmvypuwizexdhpwrgrao` no repositório; um desenvolvedor novo consegue subir o app seguindo apenas o README.

**Status (out/2026):** concluído — refs atualizados; o CI valida `pavxbcsolcvekwslhzmf` em `.env.example`/README/AGENTS e rejeita o ref antigo fora do `ANALISE-ESTRUTURA.md` (registro histórico).

---

### ENV-02 — MCP Supabase aponta para outro projeto (P0)

**Evidência:**

- O MCP ativo nesta sessão responde por `bsczvemaqvladupmdpgl.supabase.co`.
- `list_migrations` retorna apenas `create_excel_imports`, `excel_imports_single_latest` e `harden_excel_imports`.
- O app usa `pavxbcsolcvekwslhzmf`.

**Impacto:** risco de aplicar migrations/consultas no banco errado.

**Correção proposta:**

- [x] Reconfigurar o MCP do OpenCode/Cursor para o projeto `pavxbcsolcvekwslhzmf`.
- [x] Validar com `get_project_url` antes de qualquer migration.
- [x] Não usar ferramentas MCP de escrita enquanto a divergência existir.

**Critério de aceite:** `get_project_url` retorna `https://pavxbcsolcvekwslhzmf.supabase.co` e `list_migrations` mostra as migrations do Confere.ia.

**Status (out/2026):** concluído — MCP aponta para `pavxbcsolcvekwslhzmf`; `get_project_url` e `list_migrations` (19 migrations) validados em 23/10/2026.

---

### QUA-01 — Nenhum teste; CI verde sem executar nada (P0)

**Evidência:**

- `pnpm test` → `turbo run test` → `WARNING No tasks were executed as part of this run.`
- `0 successful, 0 total`.
- `.github/workflows/ci.yml:35` executa `pnpm test`, mas nenhum pacote tem script `test`.
- Não existem arquivos `*.test.ts`, `*.test.tsx`, `*.spec.ts` ou `*.spec.tsx`.

**Impacto:** regressões em autenticação, isolamento por tenant, parsing de documentos e pipeline de IA passam despercebidas. O CI dá falsa segurança.

**Correção proposta:**

- [x] Remover a etapa "Testes" do CI e o script `test`, que executavam 0 tarefas.
- [x] Adicionar Vitest (ou equivalente) em `apps/web`.
- [x] Criar testes unitários para normalização/consolidação de Invoice/BL.
- [x] Criar testes de isolamento por tenant nas funções de `lib/documents`.
- [x] Criar testes de route handlers com Supabase mockado.
- [x] Criar testes do pipeline com IA mockada (classify/extract).
- [x] Fazer o CI falhar quando não houver testes executados (quando a suíte voltar).

**Critério de aceite:** `pnpm test` executa uma suíte real; CI vermelho se os testes falharem ou se a suíte estiver vazia.

**Status (out/2026):** concluído — Vitest 5.0.5, 622 testes em 37 arquivos (funções puras, isolamento por tenant, pipeline com IA mockada, route handlers, parties, NCM, storage, ai_logs, imports, paginação, unicidade de chaves, merge/delete transacionais, fila de jobs, auth/roles, tracing/métricas, base de `lib/ai`, tasks, dedupe, leituras RLS, vínculo de `ai_logs`, rate limit, quota e guard `server-only`). O CI roda `test:coverage` e falha se a suíte sumir. Cobertura: `documents` em 94,31% de lines (gate 88%) e `ai` em 100% (gate 98%); a meta de 60% foi superada nos dois diretórios.

---

### AI-01 — Pipeline síncrono, sequencial e sujeito a timeout (P1)

**Evidência:**

- `apps/web/src/app/api/ai/analyze/route.ts:12` → `maxDuration = 120`.
- `lib/documents/analyze-pipeline.ts:89` → classificação.
- `analyze-pipeline.ts:126-220` → extrações de Invoice, Packing List e BL em sequência.
- Cada PDF pode gerar até 4 chamadas de IA antes da resposta.

**Impacto:** timeout em PDFs grandes; latência alta; custo elevado; experiência ruim em conexões lentas.

**Correção proposta:**

- [x] Migrar para processamento assíncrono (fila: pg-boss, Inngest, QStash ou similar) — fila no próprio Postgres (`ai_jobs`) com claim atômico (`claim_ai_job`/`claim_next_ai_job`), worker disparado pelo `after()` da request e endpoint de retry/cron (`/api/ai/jobs/run` com `CRON_SECRET`). Sem serviço externo.
- [x] `POST /api/ai/analyze` responde `202 Accepted` + `importId`/`jobId`.
- [x] Adicionar endpoint/página de status do processamento — `GET /api/ai/jobs/:id` (RLS por tenant) e polling no dropzone com estados Na fila/Analisando/Falhou.
- [ ] Considerar paralelizar extrações independentes com controle de rate limit — não feito: o pipeline segue sequencial e o rate limit continua por tenant na aceitação do job.
- [x] Manter `maxDuration` apenas como fallback — `maxDuration = 120` fica só no route/worker, fora do caminho da resposta.

**Critério de aceite:** upload de PDF de 10 MB não bloqueia a request por mais de poucos segundos; falhas ficam registradas e reprocessáveis.

**Status (out/2026):** concluído - migration `20261026124023_ai_jobs.sql` aplicada no cloud (23/23 no total): tabela `ai_jobs` (status queued/running/succeeded/failed, tentativas, erro, resultado), RLS de leitura por tenant e funções de claim com `for update skip locked`/limite de tentativas. O upload vai para `import-documents` em `<tenant>/_jobs/<jobId>/`, o worker baixa o arquivo, roda `runAnalyzePipeline`, marca o job e remove o arquivo; job travado em `running` volta para a fila após 15 min (até 3 tentativas). `CRON_SECRET` (novo no `.env.example`/`turbo.json`) protege o dreno da fila. Testes cobrem route 202, `after()`, worker (sucesso/falha/download/reserva), status, retry e helpers de job.

---

### AI-02 — Dedupe acontece depois da IA (P1)

**Evidência:**

- `analyze-pipeline.ts:84` calcula SHA-256.
- `analyze-pipeline.ts:89` classifica.
- `analyze-pipeline.ts:126-220` extrai.
- `analyze-pipeline.ts:251` só então chama `findDocumentsBySha256`.

**Impacto:** reenvio do mesmo arquivo paga novamente por classificação/extração; o índice `documents (tenant_id, sha256)` existe, mas não é usado antes da IA.

**Correção proposta:**

- [x] Consultar `documents` por `tenant_id + sha256` antes de qualquer chamada de IA.
- [x] Reaproveitar `extraction_results` do documento existente.
- [x] Só chamar a IA se não houver extração válida.
- [x] Registrar no retorno que o resultado veio de cache/dedupe.

**Critério de aceite:** reenviar o mesmo arquivo no mesmo tenant não gera novas chamadas de IA.

**Status (out/2026):** concluído — a checagem por `tenant_id + sha256` roda antes de `getAiOverrides`/classify/extract. Upload completo é reutilizado sem IA; com `importId` de outro import, documentos + extrações são copiados e o storage é duplicado, também sem IA. O retorno traz `deduped: true`. Se faltar extração ou o status não for `extracted`, o pipeline cai no fluxo normal.

---

### SEC-01 — `service_role` como padrão de leitura, com isolamento manual (P1)

**Evidência:**

- `lib/documents/imports.ts:124-146` usa admin client porque os grants de `private.*` podem não estar aplicados.
- O mesmo padrão aparece em `parties.ts`, `ncms.ts`, `documents.ts`, `storage.ts` e `ai-settings.ts`.
- O comentário em `imports.ts` reconhece a dependência dos grants.

**Impacto:** o RLS é contornado em leituras; o isolamento depende de cada função filtrar `tenant_id` corretamente. Um erro em um novo call site pode vazar dados entre tenants.

**Correção proposta:**

- [x] Aplicar os grants de `private.*` para `authenticated` no projeto correto.
- [x] Migrar leituras para o client do usuário (RLS) onde possível.
- [x] Manter `service_role` apenas para escritas administrativas e jobs.
- [x] Adicionar teste de isolamento por tenant para cada função de leitura.

**Critério de aceite:** leituras de `imports`, `documents`, `parties` e `ncms` funcionam com o client autenticado e RLS ativo; `service_role` fica restrito ao servidor/jobs.

**Status (out/2026):** concluído — `getReadClient()` (JWT + RLS) é usado nas leituras de `imports`, `documents`, `extraction_results`, `parties` e `ncms`; escritas, Storage e jobs seguem com `service_role`. O teste `rls-reads.test.ts` falha se qualquer leitura usar o admin client.

---

### SEC-02 — Funções administrativas sem `tenant_id` (P1)

**Evidência:**

- `fillImportKeysIfEmpty` — atualiza por `importId` apenas (`imports.ts:217-244`).
- `clearAutoReferenceIfNeeded` — idem (`imports.ts:251-273`).
- `updateImportStatus` — idem (`imports.ts:305-313`).
- `updateDocumentStatus` — idem (`documents.ts:94-107`).
- `persistExtractionResult` — grava `tenant_id` + `document_id` sem validar o vínculo (`extractions.ts:11-21`).

**Impacto:** hoje são chamadas depois de validações de tenant, mas falta defesa em profundidade. Um novo call site pode cruzar tenants.

**Correção proposta:**

- [x] Adicionar `tenantId` e filtro `.eq("tenant_id", tenantId)` em `updateDocumentStatus`, `findDocumentsBySha256` e `listImportStoragePaths`.
- [x] Aplicar o mesmo filtro em `fillImportKeysIfEmpty`, `clearAutoReferenceIfNeeded` e `updateImportStatus` (`imports.ts`).
- [x] Validar que `document_id` pertence ao tenant antes de persistir extração (via `assertDocumentOwnership`).
- [x] Centralizar a checagem em um helper `assertDocumentOwnership`.
- [x] Filtrar por `tenant_id` os updates de `analysis_results`, `product_matches` e parties em `mergeImportInto`.

**Critério de aceite:** nenhuma query administrativa é executada sem filtro de tenant; testes cobrem tentativas cross-tenant.

**Status (out/2026):** concluído — todas as funções de `documents`/`imports` do escopo filtram `tenant_id`, `persistExtractionResult` valida o vínculo via `assertDocumentOwnership` e o `mergeImportInto` filtra as três queries que faltavam. Os testes cross-tenant foram adicionados em QUA-01.

---

### DATA-01 — Operações compostas sem transação (P1)

**Evidência:**

- `mergeImportInto` (`imports.ts:474-577`) move documentos, atualiza `analysis_results`, `product_matches`, copia partes e deleta a origem em chamadas HTTP separadas.
- O pipeline (`analyze-pipeline.ts:229-394`) e o delete (`imports.ts:148-180`) seguem o mesmo padrão.

**Impacto:** falha no meio do processo deixa estado parcial (documentos movidos, origem não deletada, partes inconsistentes).

**Correção proposta:**

- [x] Criar RPC transacional para merge de importações — `public.merge_imports` (documentos versionados por tipo, `analysis_results`, `product_matches`, `ai_logs`, chaves e partes em uma transação; valida tenant e faz lock das duas importações).
- [x] Criar RPC transacional para delete de importação + documentos — `public.delete_import` remove a importação (documentos/extrações em cascata) e devolve os `storage_path` para a limpeza do Storage.
- [x] Tornar o pipeline idempotente e registrar estado (`processing`, `failed`, `awaiting_review`) — status `failed` adicionado ao check constraint; `runAnalyzePipeline` marca a importação como `failed` e propaga o erro original, mantendo o dedupe por sha256 para reprocessar sem duplicar documentos.
- [x] Adicionar compensação/rollback onde RPC não for viável — o Storage é limpo depois da transação (arquivo órfão fica registrado no log) e o merge libera as chaves da origem antes de preencher o destino.

**Critério de aceite:** simular falha em cada etapa e confirmar que nenhum estado parcial permanece.

**Status (out/2026):** concluído — migration `20261026122627_merge_delete_imports.sql` aplicada no cloud (21/21), com smoke transacional cobrindo merge (documentos, versões, resultados, `ai_logs`, chaves, partes), delete (paths + cascata), `failed` aceito e erros `P0002` para importação inexistente. As funções são `security invoker` e só o `service_role` recebe EXECUTE; o código chama via `admin.rpc(...)`. `moveDocumentsToImport` foi removido (o merge acontece no banco). Testes: RPC de delete/merge, mapeamento `P0002` e importação marcada como `failed`.

---

### DATA-02 — Consolidação de importações sujeita a corrida (P1)

**Evidência:**

- `20250813220000_import_reference_keys.sql:26-32` cria índices **não únicos** para `(tenant_id, invoice_number)` e `(tenant_id, bl_number)`.
- `findOrCreateImport` faz select e depois insert (`imports.ts:275-297`).

**Impacto:** dois uploads simultâneos com a mesma Invoice/BL podem criar importações duplicadas.

**Correção proposta:**

- [x] Definir a regra de negócio: Invoice/BL são 1:1 por tenant — sim: no máximo uma importação por `(tenant_id, bl_number)` e uma por `(tenant_id, invoice_number)`; o BL tem precedência sobre a Invoice na escolha da importação.
- [x] Se sim, criar índices únicos parciais — `imports_tenant_bl_number_key` e `imports_tenant_invoice_number_key` (parciais, `where ... is not null`), substituindo os índices comuns de `20250813220000_import_reference_keys.sql`.
- [ ] Se não, usar upsert/advisory lock ou RPC atômica — dispensado: a corrida é resolvida pelo índice único + retry.
- [x] Adicionar teste de concorrência — fake ganhou `beforeInsert` e `unique`; teste simula a outra request gravando a importação vencedora entre o select e o insert.

**Critério de aceite:** dois uploads simultâneos com a mesma chave resultam em uma única importação (ou em comportamento explicitamente definido).

**Status (out/2026):** concluído — migration `20261026114439_unique_import_keys.sql` aplicada no cloud (20/20; dedupe defensivo + índices únicos parciais). `findOrCreateImport` perde a corrida com `23505`, relê pelas chaves (BL antes de Invoice) e reutiliza a vencedora (`created: false`); `fillImportKeysIfEmpty` descarta só a coluna conflitante e segue a análise, registrando `console.warn`. Smoke no banco confirmou que os dois índices rejeitam duplicata (bloco revertido, nenhuma linha criada).

---

### DATA-03 — Sem tipos gerados do banco; divergência de roles (P2)

**Evidência:**

- `SupabaseClient` é usado sem generic de `Database`.
- Vários `as` casts em `imports.ts`, `documents.ts` e `parties.ts`.
- Banco aceita `role in ('owner','admin','operator','viewer')` (`init.sql:91`).
- TypeScript declara `MemberRole = "owner" | "admin" | "member" | "viewer"` (`lib/auth/index.ts:3`).

**Impacto:** schema e TypeScript podem divergir sem aviso; refatorações ficam mais arriscadas.

**Correção proposta:**

- [x] Gerar `apps/web/src/lib/supabase/database.types.ts` com `supabase gen types typescript` — gerado pelo MCP (`generate_typescript_types`) a partir do cloud, com `Json`/`Database` e as RPCs (`claim_ai_job`, `merge_imports`, `delete_import`, etc.).
- [x] Usar `SupabaseClient<Database>` em todos os clients — browser, server, read, public e admin criam com `createClient<Database>`/`createServerClient<Database>`/`createBrowserClient<Database>`.
- [x] Remover casts manuais — linhas de `imports`, `documents`, `parties`, `ncms` e `ai_logs` usam o tipo inferido; `ai_jobs` normaliza `status`/`result` em um mapper e `doc_type` vacina o union do domínio. Restam apenas casts de payload JSON (fronteira dos schemas zod).
- [x] Alinhar `MemberRole` ao check do banco (`operator` vs `member`) — `owner | admin | operator | viewer`, com validação do claim e fallback `viewer` para valor desconhecido.

**Critério de aceite:** `tsc` valida colunas/tabelas; não há `as` para linhas do banco nos módulos principais.

**Status (out/2026):** concluído — `database.types.ts` versionado e os cinco clients tipados; `tsc` agora acusa coluna/tabela inválida em `select`/`insert`/`update`/`rpc`. `resolveAuthState` valida o papel contra o check do banco (claim desconhecido vira `viewer`, coberto por teste). `knip.json` ignora o arquivo gerado. Regenerar após migrations: MCP `generate_typescript_types` ou `supabase gen types typescript --linked`.

---

### DOC-01 — Documentação desatualizada (P2)

**Evidência:**

- `README.md:5` diz que o pipeline “ainda não está conectado”; a linha 43 e o código mostram `/api/ai/analyze` funcionando.
- `PLAN.md:48-50` lista extração de BL como não implementada, mas `extract-bl.ts` existe e é usado no pipeline.
- `PLAN.md` também trata Packing List como não implementado; a extração atual é parcial (apenas número da Invoice).
- A tabela de rotas do README não inclui `/importacoes`, `/empresas`, `/ncm`, `/produtos` nem APIs de imports/parties/ncms.
- A tabela de variáveis do README não inclui `ADMIN_EMAILS`.
- README dizia Node >= 20, mas `@openrouter/ai-sdk-provider@3.1.0` exige **Node >= 22**. Alinhado em out/2026 (`engines` e README em `>=22`).
- README dizia default `meta/muse-spark-1.3`, mas o código usa `~openai/gpt-luna-latest` (`openrouter-model.ts:1`). Alinhado em out/2026: ambos usam `~openai/gpt-luna-latest`.

**Impacto:** onboarding e decisões técnicas baseadas em informação errada.

**Correção proposta:**

- [x] Atualizar README, AGENTS e PLAN com o estado real.
- [x] Incluir todas as rotas e variáveis.
- [x] Alinhar Node >= 22 (ou fixar provider compatível).
- [x] Documentar que o default do modelo depende do `.env` e qual é o fallback do código.

**Critério de aceite:** documentação revisada contra o build atual; nenhuma afirmação contradiz o código.

**Status (out/2026):** concluído — README/AGENTS/PLAN atualizados em 23/10/2026, incluindo rotas, variáveis, modelo padrão (`~openai/gpt-luna-latest`) e Node >= 22.12; o Node foi alinhado em DEP-01.

---

### SEC-03 — Falta de proteção `server-only` (P2)

**Evidência:**

- Nenhum arquivo usa `import "server-only"`.
- `lib/documents/index.ts` exporta módulos que dependem de `node:crypto`, `service_role` e `next/headers`.
- Hoje os componentes client importam corretamente os `*-shared`, mas nada impede um import acidental do barrel.

**Impacto:** um import errado pode arrastar código server-only para o bundle client ou quebrar o build de forma confusa.

**Correção proposta:**

- [x] Adicionar `import "server-only"` em `lib/supabase/admin.ts`, `storage.ts`, `analyze-pipeline.ts` e módulos de dados.
- [x] Manter `*-shared.ts` como única superfície client-safe.
- [x] Adicionar lint rule/import boundary se possível — guard em `lib/server-only.test.ts` garante o marcador em todo módulo não client-safe e o `next build` bloqueia imports no bundle client.

**Critério de aceite:** tentativa de importar um módulo server-only em componente client falha no build com mensagem clara.

**Status (out/2026):** concluído — 29 módulos de servidor (Supabase, documents, ai, auth, security e settings) usam `import "server-only"`; `*-shared.ts` e `supabase/client.ts` seguem client-safe. Validado negativamente: um componente client importando `lib/supabase/admin.ts` falha o `next build` com "You're importing a module that depends on server-only". O Vitest resolve o pacote para um stub vazio (`src/test/server-only.ts`).

---

### OBS-01 — `ai_logs.import_id` nunca é preenchido (P2)

**Evidência:**

- `persistAiLog` aceita `importId` (`ai-logs.ts:14`).
- Nenhuma chamada do pipeline ou da rota passa esse campo.
- A coluna existe desde `20250803180000_ai_logs_cost.sql`.

**Impacto:** relatórios de custo por importação ficam incompletos.

**Correção proposta:**

- [x] Criar a importação antes das extrações ou atualizar os logs depois.
- [x] Passar `importId` em todas as chamadas de `persistAiLog`.
- [ ] Opcional: criar view/materialized view de custo por importação.

**Critério de aceite:** novas linhas de `ai_logs` de extração têm `import_id` preenchido quando a importação já existe.

**Status (out/2026):** concluído — `persistAiLog` retorna o id e o pipeline coleta os logs de classify/extract e os vincula à importação assim que ela é criada/resolvida. O log genérico da rota também recebe o `importId` do form. Logs de falhas que ocorrem antes de a importação existir seguem com `import_id: null` (esperado).

---

### OBS-02 — Sem rate limiting nem quota de IA (P1)

**Evidência:**

- `/api/ai/analyze` exige sessão, mas não limita chamadas por tenant/usuário.
- `/api/auth/check-email` é público e revela se um email está cadastrado.
- Não há quota de tokens/custo por tenant.

**Impacto:** abuso de custo de IA; enumeração de usuários; possível DoS de funções serverless.

**Correção proposta:**

- [x] Rate limit por IP/tenant nas rotas de IA e de email.
- [x] Quota mensal de tokens/custo por tenant.
- [ ] Alerta quando o custo passar de um limiar (o bloqueio por quota já existe; alerta fica como melhoria).
- [x] Avaliar mitigação de enumeração no `check-email` — adotado rate limit por IP; a resposta `exists` foi mantida por UX.

**Critério de aceite:** limites configurados e testados; consumo anômalo gera alerta/bloqueio.

**Status (out/2026):** concluído — rate limit por tenant em `/api/ai/analyze` (30/h) e por IP em `/api/auth/check-email` (10/min), com quota mensal de 10M tokens por tenant. Migration `20261023201029_rate_limits.sql` aplicada no cloud; RPC `consume_rate_limit` validado (true, true, false para limite 2) e smoke do check-email retornando 429 no 11º request. O alerta de custo fica como melhoria incremental.

---

### OBS-03 — Observabilidade apenas “configurável” (P2)

**Evidência:**

- `SENTRY_DSN` e `OTEL_EXPORTER_OTLP_ENDPOINT` estão no `.env.example` e no `turbo.json`.
- Não há integração Sentry/OpenTelemetry no código.
- A observabilidade atual é `console.error` + `ai_logs`.

**Impacto:** dificuldade para diagnosticar falhas em produção e medir latência/custo por etapa.

**Correção proposta:**

- [x] Integrar Sentry (server + client) com release/commit — substituído por OpenTelemetry (`@vercel/otel` via `src/instrumentation.ts`), sem conta externa; Sentry segue opcional.
- [x] Instrumentar pipeline com spans (classify, extract, persist) — `ai.analyze`, `ai.job`, `ai.classify`, `ai.extract_invoice`, `ai.extract_packing_list`, `ai.extract_bl` e `ai.persist_extraction`, com atributos de tenant/importação, modelo, tokens, latência e `deduped` (sem filenames/PII).
- [x] Adicionar métricas de duração, tokens e custo por capability — histograma `ai.call.duration` e contadores `ai.call.tokens`/`ai.call.cost`, rotulados por `capability`/`model`/`status` e alimentados no mesmo ponto que grava `ai_logs`.
- [ ] Criar dashboard simples de `ai_logs` — não feito; os dados já estão em `ai_logs` e nas métricas.

**Critério de aceite:** erro em produção chega ao Sentry com contexto de tenant/importação (sem PII desnecessária).

**Status (out/2026):** concluído via OTel — `registerOTel({ serviceName: "confere-web" })` no `instrumentation.ts` (na Vercel usa a observabilidade do projeto; local/testes viram no-op). Spans e métricas usam `withSpan`/`recordAiCall` em `lib/observability/tracing.ts`; falhas de IA registram exceção e status no span, e o pipeline ainda marca a importação como `failed`. `OTEL_EXPORTER_OTLP_ENDPOINT` fica opcional no `.env.example`/`turbo.json`. Smoke local: `/login` responde 200 sem erro de inicialização do OTel.

---

### OPS-01 — Workspace residual (P3)

**Evidência:**

- `apps/worker/` local contém apenas `node_modules` e `.turbo`, referenciando pacotes removidos.
- `apps/web/src/app/api/auth/save-user-info/` existe localmente vazio.
- Ambos não estão rastreados pelo git.

**Correção proposta:**

- [x] Remover `apps/worker/`.
- [x] Remover o diretório vazio `save-user-info/`.
- [x] Rodar `pnpm install` para limpar o store, se necessário.

**Critério de aceite:** `apps/` contém apenas `web`; não há diretórios vazios em `src/app/api`.

**Status (out/2026):** concluído — `apps/` contém apenas `web` e o diretório vazio foi removido.

---

### OPS-02 — Git pendente e migrations não aplicadas (P0 operacional)

**Evidência:**

- 15 arquivos modificados (consolidação OpenRouter/Fireworks).
- 2 migrations não rastreadas:
  - `supabase/migrations/20261014120000_ai_provider_opencode.sql`
  - `supabase/migrations/20261014140000_ai_single_provider.sql`

**Impacto:** deploy pode ficar inconsistente; a configuração global de IA pode não refletir o código.

**Correção proposta:**

- [x] Revisar e commitar as alterações do provider.
- [x] Aplicar as migrations no projeto `pavxbcsolcvekwslhzmf` com Supabase CLI 2.34.3.
- [x] Validar `app_settings` (provider apenas `openrouter`).
- [x] Rodar smoke autenticado de `/api/ai/health` (200, `provider=openrouter`, `model=~openai/gpt-luna-latest`).

**Critério de aceite:** `git status` limpo; migrations aplicadas; configuração de IA salvando/lendo corretamente.

**Status (out/2026):** concluído — git limpo; 19/19 migrations aplicadas (última `20261023201029`); `app_settings` com `provider=openrouter` e `model=~openai/gpt-luna-latest`. Smoke autenticado de `/api/ai/health` em 23/10/2026: 200, `ok=true`, `source=global`, `latencyMs=2214`; sem cookie → 401. A UI de `/configuracoes` não foi exercitada neste smoke.

---

### OPS-03 — Hack de deploy na raiz (P3)

**Evidência:**

- `package.json` da raiz declara `next` como dependência.
- `apps/web` declara `@next/env` pinado em `15.5.22` apenas para carregar o `.env` da raiz.
- `vercel.json` usa `outputDirectory: apps/web/.next`.

**Impacto:** upgrades de Next podem gerar drift entre `next` e `@next/env`; a configuração é frágil.

**Correção proposta:**

- [ ] Configurar `Root Directory = apps/web` no dashboard da Vercel.
- [x] Manter `next` e `typescript` na raiz para o preview do v0 (item original de remoção cancelado).
- [x] Manter o carregamento do `.env` da raiz e documentar no `AGENTS.md`.
- [ ] Testar build/deploy após a mudança.

**Critério de aceite:** deploy funciona com Root Directory `apps/web` e sem `next` na raiz.

**Status (out/2026):** decisão revista — a raiz permanece por causa do preview do v0, então o critério de aceite não se aplica mais. O deploy com Root Directory `apps/web` segue pendente.

---

### PERF-01 — Sem paginação nas listagens (P3)

**Evidência:**

- `listTenantImports` (`imports.ts:131-146`) retorna todos os imports do tenant.
- `listTenantParties` e `listTenantNcms` seguem o mesmo padrão.

**Impacto:** tenants grandes carregam listas extensas; página `/importacoes` fica lenta.

**Correção proposta:**

- [x] Adicionar `limit/offset` ou cursor — `range()` + `count: "exact"` em `listTenantImports`, `listTenantParties` e `listTenantNcms`, retornando `Page<T>` (`rows`, `total`, `page`, `pageSize`, `totalPages`).
- [x] Adicionar busca/filtro por status e referência — `q` (referência em imports; nome/CNPJ em empresas; código/descrição em NCM) e `status` em importações.
- [x] Virtualizar tabela se necessário — dispensado: 20 linhas por página (máximo 100) cabem sem virtualização.

**Critério de aceite:** listagens carregam no máximo N registros por página, com navegação.

**Status (out/2026):** concluído — `lib/pagination.ts` centraliza `DEFAULT_PAGE_SIZE=20`, `MAX_PAGE_SIZE=100`, `normalizePage`, `normalizePageSize`, `normalizeSearch` (remove `,()"'` e limita a 120 caracteres), `escapeLike` e `buildPage`. As três listagens usam `count: "exact"` + `range` e mantêm `.eq("tenant_id", ...)` sobre `getReadClient()` (RLS). `/importacoes`, `/empresas` e `/ncm` ganharam `ListFilters` (form GET `q`/`status`) e `Pagination` (Anterior/Próxima preservando filtros); `/api/ncms` GET devolve `ncms`, `total`, `page` e `pageSize`. Testes cobrem paginação, busca case-insensitive/escape de `%`/`_`, filtro de status válido/inválido e isolamento por tenant.

---

### DX-01 — `ADMIN_EMAILS` fora do `turbo.json` (P3)

**Evidência:**

- `turbo.json:4-18` lista várias envs, mas não `ADMIN_EMAILS`.
- A variável é usada em `lib/settings/ai-settings.ts:42`.

**Impacto:** inconsistência de cache/configuração; baixo risco imediato, mas fácil de esquecer.

**Correção proposta:**

- [x] Adicionar `ADMIN_EMAILS` em `globalEnv`.
- [x] Revisar a lista de envs contra `.env.example`.

**Critério de aceite:** toda env de runtime documentada aparece em `globalEnv` ou tem justificativa.

**Status (out/2026):** concluído — `ADMIN_EMAILS` adicionada ao `globalEnv`; a lista foi revisada contra `.env.example`.

---

### DEP-01 — Contrato de Node inconsistente (P3)

**Evidência:**

- `package.json` raiz dizia `"node": ">=20"` (corrigido para `>=22.12` em out/2026; Vitest 5 exige 22.12+).
- `@openrouter/ai-sdk-provider@3.1.0`: `"node": ">=22"`.
- CI usa Node 22.

**Correção proposta:**

- [x] Atualizar `engines` para `>=22` (ou fixar versão do provider compatível com 20).
- [x] Atualizar README/AGENTS.
- [x] Adicionar `.nvmrc`/`.node-version` se fizer sentido — avaliado e dispensado; o CI fixa Node 22.

**Critério de aceite:** `engines`, CI, README e runtime de produção concordam.

**Status (out/2026):** concluído — `engines` e README em `>=22.12`; CI usa Node 22 (latest); `.nvmrc` dispensado.

---

## 8. Matriz de risco

| ID | Severidade | Categoria | Probabilidade | Impacto |
|---|---|---|---|---|
| ENV-01 | P0 | Operação | Alta | Setup/migrations no projeto errado |
| ENV-02 | P0 | Operação | Alta | Escrita no banco errado |
| QUA-01 | P0 | Qualidade | Alta | Regressões silenciosas |
| AI-01 | P1 | Custo/Disponibilidade | Média/Alta | Timeout e custo elevado |
| AI-02 | P1 | Custo | Alta | Pagar IA por arquivo duplicado |
| SEC-01 | P1 | Segurança | Média | Vazamento cross-tenant |
| SEC-02 | P1 | Segurança | Média | Vazamento cross-tenant |
| DATA-01 | P1 | Consistência | Média | Estado parcial |
| DATA-02 | P1 | Consistência | Média | Importações duplicadas |
| OBS-02 | P1 | Custo/Segurança | Média | Abuso de IA/enumeração |
| DATA-03 | P2 | Manutenibilidade | Alta | Drift schema/TS |
| DOC-01 | P2 | Manutenibilidade | Alta | Onboarding errado |
| SEC-03 | P2 | Manutenibilidade | Baixa/Média | Bundle/build quebrado |
| OBS-01 | P2 | Observabilidade | Alta | Relatórios incompletos |
| OBS-03 | P2 | Observabilidade | Alta | Diagnóstico difícil |
| OPS-01 | P3 | Limpeza | Alta | Confusão |
| OPS-02 | P0 | Operação | Alta | Deploy inconsistente |
| OPS-03 | P3 | Manutenibilidade | Média | Drift de upgrade |
| PERF-01 | P3 | Performance | Baixa/Média | Listas lentas |
| DX-01 | P3 | Configuração | Baixa | Cache inconsistente |
| DEP-01 | P3 | Configuração | Média | Falha em runtime antigo |

---

## 9. Plano de correção

### Fase 0 — Alinhamento de ambiente (P0)

**Objetivo:** garantir que todo mundo fala com o mesmo Supabase e que o deploy está reproduzível.

- [x] ENV-01 — Atualizar todos os project refs para `pavxbcsolcvekwslhzmf`.
- [x] ENV-02 — Reconfigurar o MCP e validar `get_project_url`.
- [x] OPS-02 — Commitar alterações pendentes e aplicar as 2 migrations.
- [ ] Rodar smoke local: `/login`, `/api/ai/health`, `/api/ai/analyze` com um PDF pequeno.
- [x] Confirmar que `supabase link` + `db push` funcionam no projeto correto.

**Saída esperada:** ambiente único, documentado e reproduzível.

---

### Fase 1 — Rede de segurança (P0)

**Objetivo:** impedir regressões enquanto as próximas fases avançam.

- [x] QUA-01 — Configurar Vitest.
- [x] Testar normalização de Invoice/BL e referências de importação.
- [x] Testar isolamento por tenant (cross-tenant deve falhar).
- [x] Testar pipeline com IA mockada.
- [x] CI roda Vitest e falha se não houver testes.
- [x] Adicionar cobertura mínima (ex.: 60% em `lib/documents` e `lib/ai`) — `documents` 90,75%; `ai` 100%.

**Saída esperada:** `pnpm test` real e CI confiável.

---

### Fase 2 — Pipeline de IA (P1)

**Objetivo:** reduzir custo, latência e risco de timeout.

- [x] AI-02 — Dedupe por `tenant_id + sha256` antes da IA.
- [x] Reaproveitar `extraction_results` (e copiar para outro import quando necessário).
- [x] AI-01 — Introduzir fila/processamento assíncrono.
- [ ] Adicionar status de processamento e retry.
- [x] OBS-01 — Preencher `ai_logs.import_id`.
- [x] OBS-02 — Rate limit e quota por tenant.

**Saída esperada:** upload responde rápido; reenvio não custa IA; falhas são reprocessáveis.

---

### Fase 3 — Segurança multi-tenant (P1)

**Objetivo:** reduzir dependência de `service_role` e eliminar risco de vazamento.

- [x] Aplicar grants de `private.*` para `authenticated`.
- [x] SEC-01 — Migrar leituras para o client autenticado.
- [x] SEC-02 — Adicionar `tenant_id` em todas as funções administrativas.
- [x] SEC-03 — Adicionar `server-only`.
- [ ] Adicionar testes de autorização por role (`viewer` não escreve).

**Saída esperada:** RLS ativo nas leituras; `service_role` restrito a jobs/escritas administrativas.

---

### Fase 4 — Consistência de dados (P1)

**Objetivo:** eliminar estados parciais e duplicidades.

- [x] DATA-01 — RPC transacional para merge/delete.
- [x] DATA-01 — Pipeline idempotente.
- [x] DATA-02 — Definir regra de unicidade de Invoice/BL.
- [x] Criar índices únicos parciais ou upsert atômico.
- [ ] Testes de concorrência.

**Saída esperada:** operações atômicas e sem duplicidade em cenários de corrida.

---

### Fase 5 — Tipos e documentação (P2)

**Objetivo:** reduzir drift e melhorar onboarding.

- [x] DATA-03 — Gerar `database.types.ts` e usar `SupabaseClient<Database>`.
- [ ] Alinhar roles (`operator` vs `member`).
- [x] DOC-01 — Atualizar README, AGENTS e PLAN.
- [x] DEP-01 — Alinhar Node >= 22.
- [x] Atualizar rotas, envs e default de modelo.

**Saída esperada:** documentação e tipos confiáveis; onboarding sem surpresas.

---

### Fase 6 — Operação e performance (P2/P3)

**Objetivo:** tornar o produto observável e escalável.

- [x] OBS-03 — Integrar Sentry/OpenTelemetry.
- [x] PERF-01 — Paginação e filtros nas listagens.
- [x] OPS-01 — Limpar workspace residual.
- [ ] OPS-03 — Reavaliar deploy com Root Directory `apps/web`.
- [x] DX-01 — Completar `turbo.json.globalEnv`.

**Saída esperada:** produção observável, listas escaláveis e deploy simplificado.

---

## 10. Decisões pendentes

Estas decisões precisam ser tomadas antes de algumas correções. Todas as cinco abaixo já foram decididas em out/2026.

1. **Invoice/BL são 1:1 por tenant?**
   - **Decidido (out/2026):** sim — índices únicos parciais em `(tenant_id, bl_number)` e `(tenant_id, invoice_number)`; BL tem precedência e a corrida é resolvida com retry em `23505`.
2. **Qual infraestrutura de fila usar?**
   - **Decidido (out/2026):** fila no próprio Postgres (`ai_jobs`) com claim atômico, worker no `after()` da request e dreno via `/api/ai/jobs/run` (`CRON_SECRET`). Sem serviço externo; Inngest/QStash continuam opções se o volume crescer.
3. **Leituras devem voltar para RLS ou continuar via service role?**
   - **Decidido (out/2026):** leituras via RLS com `getReadClient()`; `service_role` fica restrito a escritas administrativas, Storage e jobs.
4. **O deploy continuará na raiz ou passará para `apps/web`?**
   - **Decidido (out/2026):** continua na raiz — `next`/`typescript` são necessários para o preview do v0. Configurar `Root Directory = apps/web` na Vercel fica opcional.
5. **Qual o nível mínimo de cobertura de testes aceitável?**
   - **Decidido (out/2026):** gate no CI — `documents` 88% (medido 91,78%) e `ai` 98% (medido 100%). A meta de 60% foi superada nos dois diretórios.
   - Sugestão original: 60% em `lib/documents` e `lib/ai`; 100% dos caminhos críticos de auth/tenant.
6. **O `check-email` deve continuar revelando existência de conta?**
   - Trade-off de UX vs enumeração; documentar a decisão.

---

## 11. Comandos úteis

### Qualidade

```bash
pnpm --filter @confere/web typecheck
pnpm --filter @confere/web lint
pnpm build
pnpm test
```

### Supabase

```bash
# Sempre confirmar o project ref antes:
supabase link --project-ref pavxbcsolcvekwslhzmf
supabase db push

# Criar migration:
pnpm db:migration <nome>
```

> **Atenção:** usar Supabase CLI 2.34.3 para migrations. Versões 2.110+ têm um engine novo que pode quebrar funções dollar-quoted e esconder o erro real do Postgres (ver `AGENTS.md`).

### Smoke local

```bash
curl -s http://localhost:3000/login | head -1
curl -s -X POST http://localhost:3000/api/auth/check-email \
  -H 'Content-Type: application/json' \
  -d '{"email":"teste@empresa.com"}'

# Autenticado:
curl -s http://localhost:3000/api/ai/health --cookie 'sb-confere-auth-token=...'
```

---

## 12. Definition of Done global

Considerar a correção concluída quando:

- [x] Todos os project refs apontam para `pavxbcsolcvekwslhzmf` e o MCP está alinhado.
- [x] Existe uma suíte real de testes e o CI falha sem testes.
- [ ] Upload de PDF não bloqueia por mais de poucos segundos; reenvio não gera custo de IA.
- [x] Leituras usam RLS (ou têm filtro de tenant explícito e testado).
- [ ] Merge/delete/pipeline são atômicos ou idempotentes.
- [ ] `database.types.ts` é gerado e usado.
- [x] README/AGENTS/PLAN refletem o estado real.
- [ ] Sentry/OTEL integrados (o `ai_logs.import_id` já foi concluído).
- [x] Rate limit/quota configurados.
- [x] `git status` limpo e migrations aplicadas.

---

## Apêndice A — Inventário de tabelas

| Tabela | Propósito | Uso atual |
|---|---|---|
| `tenants` | Empresas | Auth/tenant |
| `tenant_members` | Membros e roles | Auth/tenant |
| `tenant_settings` | Configurações por tenant | Pouco usado |
| `app_settings` | Config global (IA) | `/configuracoes` |
| `products` | Catálogo de produtos | Placeholder |
| `imports` | Importações | Ativo |
| `documents` | Arquivos enviados | Ativo |
| `extraction_results` | Dados extraídos | Ativo |
| `analysis_results` | Comparações | Não usado |
| `product_matches` | Match com catálogo | Não usado |
| `parties` | Consignee/notify | Ativo |
| `ncms` | Catálogo NCM | Ativo |
| `audit_logs` | Auditoria | Não usado |
| `ai_logs` | Logs/custo de IA | Ativo (com `import_id` quando vinculado) |
| `rate_limit_buckets` | Buckets de rate limit (janela fixa) | `/api/ai/analyze` e `/api/auth/check-email` |

### Funções auxiliares

- `private.current_tenant_id()`
- `private.current_role()`
- `private.is_tenant_member(uuid)`
- `private.has_tenant_role(uuid, text[])`
- `private.touch_updated_at()`
- `private.handle_new_user()`
- `public.create_tenant_with_owner(text)`
- `public.custom_access_token_hook(jsonb)`
- `public.email_registered(text)`

---

## Apêndice B — Hotspots de complexidade

| Arquivo | Tamanho | Observação |
|---|---|---|
| `components/importacoes/importacao-form.tsx` | ~19 KB | Componente client grande; considerar dividir por seção |
| `lib/documents/parties.ts` | ~18 KB | Muitas queries e regras de resolução; candidato a split |
| `lib/documents/imports.ts` | ~16 KB / 577 linhas | Merge, lookups e status no mesmo módulo |
| `lib/documents/analyze-pipeline.ts` | ~13 KB | Orquestração extensa; candidato a etapas nomeadas |
| `lib/ai/tasks/extract-bl.ts` | ~8,5 KB | Muitos campos; schema já ajuda |
| `components/analise/upload-dropzone.tsx` | ~8 KB | Fluxo de upload + redirects |

**Sugestão:** ao tocar nesses arquivos, extrair submodules por responsabilidade, sem reestruturação ampla imediata.

---

## Apêndice C — Evidências da análise

- `pnpm --filter @confere/web typecheck` → passou.
- `pnpm --filter @confere/web lint` → passou.
- `pnpm build` → passou; 24 rotas; 18 páginas estáticas geradas.
- `pnpm test` → `0 successful, 0 total`.
- Health check Supabase:
  - `pavxbcsolcvekwslhzmf` → HTTP 200.
  - `xmvypuwizexdhpwrgrao` → DNS não resolve.
- REST read-only no projeto `pavx`:
  - `imports`, `documents`, `tenants`, `app_settings`, `parties`, `ncms`, `ai_logs` → HTTP 200 com colunas esperadas.
- MCP Supabase ativo:
  - `get_project_url` → `https://bsczvemaqvladupmdpgl.supabase.co`.
  - `list_migrations` → apenas migrations de `excel_imports`.

Nenhuma chave, token ou segredo foi incluído neste documento.

---

## Apêndice D — Ordem sugerida de execução

```text
1. ENV-01 / ENV-02 / OPS-02   (alinhar ambiente e commitar)
2. QUA-01                      (testes + CI)
3. AI-02                       (dedupe antes da IA)
4. AI-01 / OBS-01 / OBS-02     (fila, logs, limites)
5. SEC-01 / SEC-02 / SEC-03    (RLS e defesa em profundidade)
6. DATA-01 / DATA-02           (transações e unicidade)
7. DATA-03 / DOC-01 / DEP-01   (tipos e documentação)
8. OBS-03 / PERF-01 / OPS-01 / OPS-03 / DX-01
```

A ordem pode ser ajustada conforme prioridade de produto, mas os itens da fase 0 e 1 devem vir antes de qualquer nova feature relevante.
