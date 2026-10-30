# AGENTS.md

## Instruções para agentes

Confere.ia é um monorepo pnpm + Turborepo (web + Supabase cloud).
Comandos padrão (lint/typecheck/build/dev) estão no `README.md` e no `package.json` raiz — use-os.
Roadmap e estado do produto: `PLAN.md`.
Auditoria de código morto e exports: `pnpm dlx knip` (esperado: 0 issues).

**Subagentes**: escreva os prompts em **inglês** (mais direto e barato em tokens) e peça resposta em inglês; traduza o resumo para o usuário em português. Exceção: conteúdo que precisa ser literal em pt-BR (textos de UI, mensagens, docs do produto).

### Serviços

- **Supabase cloud**: `https://pavxbcsolcvekwslhzmf.supabase.co` — fornece DB e Auth.
- **Web** (`apps/web`, Next.js): `http://localhost:3000`. Login/signup; app com sidebar (`/analise`, `/importacoes`, `/empresas`, `/ncm`, `/produtos`; `/configuracoes` só para admin).

### Como rodar (sem Docker)

O projeto usa apenas Supabase cloud — não é necessário Docker, rede IPv6 ou `supabase start`.

1. **Configurar variáveis de ambiente**:
   ```bash
   pnpm install
   cp .env.example .env
   ```
   Edite o `.env` na raiz e preencha (**uma chave por linha**):
   - `NEXT_PUBLIC_SUPABASE_URL=https://pavxbcsolcvekwslhzmf.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — chave publishable (`sb_publishable_...`)
   - `FIREWORKS_API_KEY` — provedor padrão de IA (`https://app.fireworks.ai/settings/api-keys`);
     sem ela, `/api/ai/health` e as análises respondem 503/502
   - `OPENROUTER_API_KEY` — opção alternativa (`https://openrouter.ai/settings/keys`)

   Chaves em: Supabase Dashboard > Settings > API Keys. **Não deixe `SUPABASE_INTERNAL_URL=` vazio**
   — remova a linha ou deixe comentada para usar `NEXT_PUBLIC_SUPABASE_URL`.
   Fallback legado: `NEXT_PUBLIC_SUPABASE_ANON_KEY` (JWT).

   O Next carrega o `.env` da raiz via `apps/web/next.config.ts` — não use `apps/web/.env.local`.
   Se existir `.env.local` **na raiz**, ele é carregado com **prioridade sobre o `.env`** (é onde a
   Vercel CLI grava `VERCEL_OIDC_TOKEN`); não coloque configuração do produto nele.

   **Só as chaves são obrigatórias.** Modelo, rate limits, orçamentos de crédito, cadência do
   rastreio e knobs do parse têm default no código; o `.env.example` lista os opcionais comentados
   com o default ao lado. Precedência do modelo: `app_settings.ai` (dropdown de `/configuracoes`)
   → `FIREWORKS_MODEL`/`OPENROUTER_MODEL` do `.env` → `DEFAULT_FIREWORKS_MODEL`/
   `DEFAULT_OPENROUTER_MODEL` em `lib/ai/providers/*`. Um clone novo **sem** `.env` ainda compila e
   sobe, mas o login não funciona (falta a publishable key) e a IA responde 503 sem a chave do
   provider.

   **Env vazio no processo ganha do arquivo:** se o shell/CI exportar
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=` (string vazia), o Next **não** aplica o valor
   do `.env`. Faça `unset` da variável ou defina o valor real antes do `pnpm dev`.
2. **Web**:
   ```bash
   pnpm --filter @confere/web dev   # http://localhost:3000
   # ou: pnpm dev
   ```

### Provedor de IA (Fireworks + OpenRouter)

- Client servidor: [`apps/web/src/lib/ai`](apps/web/src/lib/ai) — `provider.ts`
  (`getAiProvider`/`getAiModelId`/`getDefaultLanguageModel`).
- **Fireworks (padrão)**: `createFireworksClient` + `FIREWORKS_MODEL`
  (`accounts/fireworks/routers/deepseek-flash-latest`; alternativa
  `accounts/fireworks/routers/glm-flash-latest`). A config global em `app_settings`
  está em **`accounts/fireworks/models/deepseek-v4p1-flash-1017`** (DeepSeek V4.1 Flash). A API não aceita PDF: o pipeline converte as
  páginas em JPEG (`pdf-to-img`, até 30 páginas/~7 MB) e reutiliza as imagens nas 4 tasks.
- **OpenRouter (opção)**: `createOpenRouterClient` + `OPENROUTER_MODEL`; reasoning via
  `OPENROUTER_REASONING_*`; PDFs com plugin file-parser (+ fallback mistral-ocr).
- `AI_PROVIDER` escolhe o padrão do servidor quando não há config global; o dropdown em
  `/configuracoes` grava `app_settings` (`fireworks`/`openrouter`) e vale para todos os tenants.
- Modelos no catálogo: Fireworks DeepSeek/GLM Flash e OpenRouter `~openai/gpt-luna-latest` /
  `meta/muse-spark-1.3`.
- Smoke autenticado: `GET /api/ai/health` (exige sessão Supabase).
  - Sem cookie → `401`; sem chave do provider ativo → `503`; sucesso → `{ ok, provider, model, text, latencyMs }`.
- Análise de documento: `POST /api/ai/analyze` (multipart `file`) responde **202** e enfileira
  (`ai_jobs`); o worker baixa o arquivo, prepara o documento (PDF→imagens no Fireworks) e roda
  classificação/extração. Status em `GET /api/ai/jobs/[jobId]`.
  - Classifica tipos (`invoice` / `packing_list` / `bill_of_lading`; multi-tipo permitido).
  - Se houver Invoice, extrai número, exportador, importador, notify e produtos.
  - Persiste Storage `import-documents` + `imports`/`documents`; `extraction_results`/`ai_logs` via **service role**. Leituras de domínio via **RLS** (`getReadClient`).
  - Rate limit por tenant em `/api/ai/analyze` (30/h) e quota mensal de 10M tokens; `/api/auth/check-email` limitado por IP (10/min).
- Chaves só no servidor: `FIREWORKS_API_KEY`, `OPENROUTER_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
  (nunca `NEXT_PUBLIC_*`).
- Config global de IA (só allowlist `ADMIN_EMAILS` — todo signup vira owner do próprio
  tenant, então role sozinha não restringe): página `/configuracoes` + `GET/PUT/DELETE /api/settings/ai`
  (persiste tabela `app_settings` chave `ai` `{provider, model}` via service role, sem policies p/
  anon/authenticated; NULL = padrão do env; vale para todos os tenants).
  Pipeline (`runAnalyzePipeline`) e `/api/ai/health` usam a config global.
- Packing List: extração limitada ao número de Invoice, quando explicitamente indicado.
- BL: extrai campos próprios do conhecimento e empresas; não fornece número de Invoice.

### Rastreio de BL/container

- Módulo servidor: [`apps/web/src/lib/tracking`](apps/web/src/lib/tracking) — tipos/labels em `shared.ts`, validação ISO 6346 em `validate.ts`, armadores + deep links em `carriers.ts`, prefixos de BL/master em `bl-prefix.ts`, normalização em `normalize.ts`, provider Firecrawl em `firecrawl.ts`, persistência/fila em `service.ts`.
- Fluxo: o pipeline (`analyze-pipeline.ts`) chama `enqueueTrackingForImport` após persistir o BL e, na sequência, roda a **primeira consulta na hora** (`processQueuedTrackingJobs` com `importId`/`limit: 1`) para trazer o ETA junto com a análise; o restante roda no botão "Atualizar" (`POST /api/imports/[id]/tracking/refresh`) ou no cron `GET/POST /api/tracking/run` (Bearer `CRON_SECRET`). O cron chama `enqueueDueTrackingShipments` **antes** de `processQueuedTrackingJobs`: reenfileira (até 8) os shipments com `next_check_at` nulo/vencido, `strategy` `http`/`firecrawl`, não terminais e sem job `queued`/`running`; sem isso, a fila não se realimentaria depois da primeira consulta. O plano Hobby da Vercel só permite **cron diário** (06:00 UTC no `vercel.json`); para 15 min use um cron externo apontando para a rota (lote de processamento ≤ 4 por execução).
- **BL master de agente de carga**: a extração do BL (`lib/ai/schemas.ts`/`tasks/extract-bl.ts`) preenche `masterBlNumber` com `MASTER B/L`, `MBL NO.`, `OCEAN B/L` ou `B/L MASTER` (fallback determinístico no markdown em `lib/ai/bl-normalize.ts`). O número fica no payload da extração (editável como "BL master (MBL)"); `imports` não ganha coluna. No detalhe do rastreio, o shipment `query_type='bl'` com `query_value ≠ imports.bl_number` é rotulado **BL master**.
- **Uma consulta por importação**: BL e containers são o mesmo embarque, então `buildTrackingTargets` deixa **um único alvo consultável**, nesta ordem: (1) **BL do documento** quando o número tem o prefixo/formato do armador (`lib/tracking/bl-prefix.ts`: Maersk `MAEU`/`MRKU`/9 dígitos, MSC `MEDU`/`MSCU`, CMA `CMDU`, COSCO `COSU`, Evergreen `EGLV`/12 dígitos, Hapag `HLCU`, HMM `HMMU`, ONE `ONEY`, OOCL `OOLU`); (2) **BL master** (`masterBlNumber`) quando o BL é de casa e o master tem o prefixo (`carrierFromBlPrefix` cobre armador não identificado); (3) **primeiro container válido** quando não há BL rastreável. `looksLikeCarrierBl` devolve `true` para armador `unknown` (não dá para decidir), então o BL do documento continua como consulta e o fallback cobre `not_found`. Quando o provider **não aceita container** (nenhum dos atuais; OOCL é `link` por captcha), BL e containers ficam `link` (manual). Os shipments de todos os containers continuam criados para exibição/evento manual. `enqueueTrackingForImport` reconcilia linhas antigas (rebaixa `http`/`firecrawl` para `link`, inclui o BL de casa trocado pelo master, e encerra jobs `queued` com `single_query_target`). O botão "Atualizar" enfileira e processa **1** job via `processQueuedTrackingJobs({ importId, limit: 1, worker: "refresh" })` — não chama `processShipment` direto nem deixa job órfão. O botão aplica **cooldown por importação** (`TRACKING_REFRESH_COOLDOWN_MINUTES`, padrão 30, `0` desativa) sobre o `fetched_at` do alvo consultável: consulta recente (inclusive `not_found`/`error`) não é repetida nem com `force` e a rota responde 200 com `skipped: "cooldown"` + `retryAfterSeconds`; o cron e a primeira consulta da análise não passam por ele.
- **Fallback BL `not_found` → 1º container**: quando o BL (ou o master) consultado volta `not_found` (ex.: HMM com BL de casa, `MSIRYOE261000021`), `processShipment` chama `fallbackToFirstContainer`: só age se **não** existe outro container consultável (`strategy in ('http','firecrawl')`), existe container `link` (primeiro por `created_at asc`) e `carrierSupportsContainer(carrier_code)`. Promove esse container para `trackingStrategyForCarrier(carrier_code)` (`http`/`firecrawl`, `next_check_at = null`), rebaixa o BL (e qualquer outro alvo automático) para `link` e processa o container **uma vez** via `processShipment` — sem job novo, mantendo **um** alvo consultável. O `eta` do container preenche o payload do BL (`fillBlEta: true`, só se vazio). Nunca dispara a partir de container (sem loop) nem quando o BL voltou `found`; falha do fallback é logada (`[tracking] fallback de container falhou:`) e engolida (BL e job seguem `done`).
- Cadência (`nextCheckAtFor`, `lib/tracking/config.ts`): **semanal (7 dias)** por importação e **diária** quando faltar **≤ 7 dias** para o ETA (`TRACKING_IN_TRANSIT_INTERVAL_MINUTES=1440`, `TRACKING_FAR_ETA_INTERVAL_MINUTES=10080`). `not_found` segue 24h e erro/blocked usa backoff (máx. 24h).
- Tabelas: `tracking_shipments` (1 por BL/container, **apenas um consultável por importação**), `tracking_events` (timeline deduplicada por `fingerprint`), `tracking_jobs` (fila com claim via RPC, service role) e `tracking_usage` (créditos por tenant/mês). Leitura por RLS; escrita só service role.
- **ETA no formulário do BL**: quando o snapshot do **alvo consultado** (o BL, o primeiro container quando o BL é `link` ou o container promovido pelo fallback de BL `not_found`) traz `eta`, `persistSnapshot` chama `fillBlEtaFromTracking` e grava `payload.eta` da `extraction_results` mais recente do BL (`documents.doc_type = 'bill_of_lading'`, ordem `created_at desc`) em **DD/MM/AAAA** — o campo do formulário (`BL_DATE_FIELDS`); `imports` continua **sem** coluna de ETA. Só preenche quando `payload.eta` está nulo/vazio (nunca sobrescreve extração/edição manual). Usa `createSupabaseAdminClient` (cron/worker sem sessão; não usa `getReadClient`/`assertDocumentOwnership`) e roda em `try/catch`: falha no ETA é logada (`[tracking] falha ao preencher ETA do BL`) e não derruba o rastreio. Containers `link` (fan-out) não preenchem.
- Firecrawl: `FIRECRAWL_API_KEY` só no servidor. v1 usa extração JSON (5 créditos/página), porque os portais são SPAs; `markdown` (1 crédito) fica para quando houver parser por armador. **Sempre** use `maxAge: 0` para rastreio — o default de 2 dias devolveria status velho.
- **MSC não usa Firecrawl**: `lib/tracking/providers/msc.ts` abre a página (cookie de sessão) e chama a API interna `/api/feature/tools/TrackingInfo` (JSON), com 0 créditos. O BL de casa do forwarder é `link`; o primeiro container traz os eventos e os demais ficam `link`.
- **Maersk** exige `proxy: "stealth"` e `waitFor` de ~18s (Akamai). O BL devolve os containers e o fan-out evita consultas individuais; o retry (`attempts = 2`) vale **só** para `not_found` real do portal, nunca para divergência de navio.
- **Divergência de navio é aceita** (`lib/tracking/normalize.ts`): rollover/transbordo é legítimo. O snapshot continua `found` com status/ETA/containers/eventos do portal (navio/viagem exibidos são os do portal; o BL fica intacto), recebe `vesselMismatch: { expected, found }` + nota curta e o detalhe do rastreio mostra um aviso discreto ("possível transbordo/rollover"). O metadado é persistido em `tracking_shipments.raw.snapshot`. Só **container divergente** (`reportedContainers`) continua rejeitado como "outro embarque".
- **COSCO** usa a SPA nova `/scct/public/ct/base?trackingType=blNumber|containerNumber&number=...` com `waitFor` de ~14s; a própria URL dispara a busca e o BL devolve os containers (fan-out).
- **OOCL** fica em `link` + evento manual: o portal exige captcha da CargoSmart, que não é automatizável no Firecrawl. A tela de rastreio mostra o botão para o portal.
- **HMM** usa API interna (`lib/tracking/providers/hmm.ts`, 0 créditos) com sessão + CSRF. BL com prefixo `HMMU` é autoritativo (container `link`); BL de casa sem master cai para o primeiro container, porque a API aceita `cntr`.
- **ONE** usa a API interna `ecomm.one-line.com/api` (`lib/tracking/providers/one.ts`, 0 créditos). BL `ONEY` é autoritativo e o container fica `link` (recarga); BL de casa sem master cai para o primeiro container (`CNTR_NO`).
- **Hapag-Lloyd** usa formulário AEM via Firecrawl `actions` (`track-by-container`/`track-by-booking`, ~12s). Em 28/10/2026 o portal estava em manutenção; BL de casa fica `link`, Hapag é inferida por containers `HLBU/HLXU/HLKU`.
- Orçamento: `TRACKING_FIRECRAWL_MONTHLY_CREDITS` (tenant) e `TRACKING_FIRECRAWL_GLOBAL_CREDITS`; ao estourar, o shipment vira `blocked` e a UI oferece link do armador + evento manual.
- Fallback universal: `buildCarrierDeepLink` + `POST /api/imports/[id]/tracking/events` (owner/admin/operator). Sem `FIRECRAWL_API_KEY`, o rastreio fica bloqueado mas a análise segue normal.
- Armadores v1: Maersk, MSC, CMA CGM, Hapag-Lloyd, COSCO, Evergreen, HMM, ONE e OOCL (link/manual). MSC, HMM, ONE (APIs internas), CMA, Evergreen, Maersk e COSCO foram validados com BLs reais; Hapag-Lloyd tem adapter pronto, mas o portal estava em manutenção em 28/10/2026 — ver `docs/tracking.md`.
- **Proteções contra loops/consumo**: rate limit 10/h no refresh, cooldown por importação, orçamento mensal tenant/global, lock de 10 min, claim atômico com **stale recovery** (`claim_tracking_jobs`: `queued` vencido ou `running` com lock expirado e `attempts < 3`; quem estourou vira `failed`/`stale_timeout` — o mesmo critério no claim escopado por importação em TS) e lotes do cron; `maxDuration` 120 no refresh (pior caso do Firecrawl ~65s); na IA, 30 análises/h, quota de tokens, timeout 90s + 1 retry, `ai_jobs` ≤ 3 tentativas/stale 15 min e dreno 3/240s, e smoke `/api/ai/health` limitado a 20/h por tenant (429 + `Retry-After`, sem `ai_logs`); parse com cache e orçamento próprios. Auditoria completa (gaps restantes: teto global de rastreio não atômico, overshoot do orçamento de parse, `maxRetries` do SDK de IA) em `docs/tracking.md` → “Proteções contra loops e consumo”.

### Parse de PDF em markdown (Firecrawl `/v2/parse`)

- Antes das 4 tasks de IA, o PDF é enviado a `POST https://api.firecrawl.dev/v2/parse` com `mode: auto` (OCR automático para scan), no máximo `DOCUMENT_PARSE_MAX_PAGES` (30) páginas; custa **1 crédito/página**.
- O markdown resultante entra nas tasks como **`TextPart`** (um único texto, provider-agnóstico), substituindo o `FilePart`/imagens. Tabelas podem vir como **HTML** (`<table>`) e o prompt avisa o modelo para corrigir ruído de OCR.
- **Fallback**: falha, markdown curto (`DOCUMENT_PARSE_MIN_CHARS`), timeout ou orçamento estourado → pipeline atual (PDF→JPEG no Fireworks / PDF no OpenRouter). O parse é acessório: nunca derruba a análise.
- **Cache** por `(tenant_id, sha256)` na tabela `document_parses` (markdown + páginas + status): reenviar o mesmo arquivo não gasta crédito. Leitura/escrita via service role.
- **Orçamento** mensal por tenant em `DOCUMENT_PARSE_MONTHLY_CREDITS` (0 = sem teto), medido em créditos/páginas.
- **Privacidade**: o documento completo (não só o texto extraído) passa pelo Firecrawl — trate como processador externo ao definir retenção/contrato.
- `DOCUMENT_PARSE_PROVIDER=images` (ou `FIRECRAWL_API_KEY` ausente) desliga o parse e mantém o comportamento anterior.
- Detalhes, riscos e teste manual: `docs/pdf-markdown.md`.

### Fluxo da análise (upload → Firecrawl → modelo)

1. **Upload** (`POST /api/ai/analyze`) grava o arquivo em `<tenant>/_jobs/<jobId>/`, cria `ai_jobs` (`queued`) e responde **202**.
2. **Worker** (`after()` da request; `/api/ai/jobs/run` drena órfãos) baixa o arquivo e chama `prepareDocument`.
3. **Firecrawl** converte o PDF em markdown (`POST /v2/parse`, 1 crédito/página, cache por `(tenant, sha256)`). Se o parse falhar/estourar orçamento, cai para JPEG (Fireworks) ou PDF nativo (OpenRouter) — rede de segurança.
4. **Modelo configurado** recebe esse markdown como um único `TextPart` (tabelas podem vir em HTML) e roda `classify` → `extract_invoice` / `extract_packing_list` / `extract_bl`.
   - A classificação é **heurística primeiro** (`lib/ai/document-type-heuristic.ts`: cabeçalhos `BILL OF LADING`/`BL NO.`, `COMMERCIAL INVOICE`, `PACKING LIST`); o modelo só classifica quando não há marcador forte. `ai_logs` registra `model = heuristic` nesse caso.
5. **Persistência**: `imports`, Storage `import-documents`, `documents`, `extraction_results`, `ai_logs`, consignee padrão/divergências, partes pendentes e, se houver BL, `tracking_jobs`.
   - A **referência da importação** sai do próprio arquivo (`lib/documents/import-reference.ts`): campos `EXPORT REFERENCES`/`REFERENCE`/`CONTRACT NO.`/`P.O.`/`BOOKING NO.` e, na falta deles, o código do nome do arquivo (`OYH128 draft bl - ...pdf` → `OYH128`). Só preenche quando `reference_number` está nulo — nunca sobrescreve o valor digitado.

- Cada chamada de IA tem orçamento próprio (`AI_TASK_TIMEOUT_MS`, padrão 90s) e **1 retentativa** (`AI_TASK_RETRIES`) apenas em timeout; erro de API/schema não é repetido (o SDK já tem `maxRetries`).
- `maxDuration = 300` em `/api/ai/analyze` e `/api/ai/jobs/run` (teto do Hobby com Fluid compute). O dreno da fila para em 240s para fechar a response antes do teto.
- Falha de `extract_bl`/`extract_packing_list` **não** derruba a importação: o documento fica `failed`, o motivo vai para `ai_logs` e a tela da importação mostra o aviso (vale a tentativa mais recente de cada capability).
- Reenvio do mesmo arquivo no tenant reaproveita a extração existente (`deduped`), sem chamar Firecrawl nem o modelo.

### Extração de BL (normalização)

- `apps/web/src/lib/ai/bl-normalize.ts` roda depois da IA e antes de persistir: `grossWeight`/`measurement`/`freightValue` em pt-BR (preservando as casas), datas em DD/MM/AAAA, `volumes`/`containerQuantity` inteiros, `containerType` no formato `40 HC`, descrição sem boilerplate (`SHIPPER'S LOAD AND COUNT`, `SAID TO CONTAIN`) e `carrier` oceânico inferido do navio/containers quando o BL é emitido por forwarder (LX Pantos, YQN etc.).
- O prompt (`lib/ai/tasks/extract-bl.ts`) manda ler o rider/anexo para volumes, NCM, OFT/THD e free time.

### Migrations no cloud

Para aplicar ou criar migrations no projeto hospedado:

```bash
supabase link --project-ref pavxbcsolcvekwslhzmf
supabase db push          # aplica supabase/migrations/
pnpm db:migration <nome>  # cria nova migration em supabase/migrations/
```

Histórico cloud reconciliado com os arquivos locais em 13/10/2026 — `db push`
só aplicará arquivos novos (inclui `drop_connection_test` e
`repair_migration_history`, idempotentes).

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
- Server/proxy usam `NEXT_PUBLIC_SUPABASE_URL` diretamente
- Proxy ignora `/supabase` no matcher; limpa `sb-confere-auth-token*` se `getUser()` falhar
- Cookie de sessão com nome fixo `sb-confere-auth-token` nos três clientes (browser/server/proxy)
- `/api/auth/check-email` usa [`createSupabasePublicClient`](apps/web/src/lib/supabase/public-client.ts) (**sem cookies**)
  — evita JWT antigo (ex.: Supabase local) contaminar a RPC `email_registered`
- Publishable key: [`createSupabaseFetch`](apps/web/src/lib/supabase/fetch.ts) remove `Authorization: Bearer sb_publishable_...`
  (não é JWT; PostgREST responde `PGRST301` se enviada como Bearer)

### Estado atual do produto

| Área | Status |
|------|--------|
| Login / signup / logout | Funcional (cloud + publishable key) |
| Provisionamento automático de tenant | Funcional (trigger no signup) |
| Página `/analise` | Dropzone → `/api/ai/analyze` (202 + job), status via `/api/ai/jobs/[jobId]` e extrações persistidas |
| Página `/importacoes` | Lista `imports` do tenant (RLS com o client autenticado) |
| Página `/empresas` | Lista as parties do tenant (RLS); edição em `/empresas/[id]` |
| Página `/ncm` | Lista (RLS) / cria / edita NCMs do tenant (`/ncm/nova`, `/ncm/[id]`) |
| Página `/configuracoes` | Super-admin (`ADMIN_EMAILS`): consignee padrão do tenant + provedor/modelo de IA global + teste de conexão |
| Página `/admin` | Super-admin (`ADMIN_EMAILS`): painel global somente leitura (tenants, contadores, uso de IA, detalhe por tenant auditado) |
| Página `/produtos` | Placeholder (CRUD pendente) |
| Shell autenticado | Sidebar: Nova análise, Importações, Empresas, NCM, Produtos (+ Admin e Configurações só para super-admin) |
| IA (Fireworks + OpenRouter) | Fireworks padrão (`deepseek-flash-latest`, GLM alternativa; PDF→markdown via Firecrawl `/v2/parse`, fallback PDF→imagens) + OpenRouter opcional; `/api/ai/health` |
| Observabilidade | OTel (`@vercel/otel` no `instrumentation.ts`); spans `ai.analyze`/`ai.job`/`ai.classify`/`ai.extract_*`/`ai.persist_extraction` e métricas por capability |
| Classificação + extração | Fila `ai_jobs` (202 + worker via `after()`/`/api/ai/jobs/run`); Invoice e número da Invoice no PL em `extraction_results`; BL sem número da Invoice |
| Rastreio de BL/container | Firecrawl + timeline/ETA por importação; **uma consulta por importação** (BL com prefixo → master BL → primeiro container), cadência semanal/diária, cron diário e refresh pela fila; orçamento de créditos e fallback manual |
| Pipeline completo (extração integral de PL, comparação) | Não implementado |
| Testes automatizados | Vitest 5.0.5 — 1.208 testes em 72 arquivos; CI roda `test:coverage` (gates: `documents` 96% funções/88% linhas, `ai` 98%, `tracking` 85% linhas) |

Detalhes e próximos passos: [`PLAN.md`](PLAN.md).

### Smoke check rápido

Com as chaves reais do projeto cloud:

```bash
# Defina KEY com NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY do .env
curl -s https://pavxbcsolcvekwslhzmf.supabase.co/auth/v1/health -H "apikey: $KEY"
curl -s http://localhost:3000/supabase/auth/v1/health -H "apikey: $KEY"
curl -sI http://localhost:3000/login | head -1
curl -s -X POST http://localhost:3000/api/auth/check-email \
  -H 'Content-Type: application/json' \
  -d '{"email":"teste@empresa.com"}'   # {"exists":false|true}
# IA (sessão autenticada + chave do provider ativo no .env da raiz):
# curl -s http://localhost:3000/api/ai/health --cookie 'sb-confere-auth-token=...'
# → {"ok":true,"provider":"fireworks","model":"accounts/fireworks/routers/deepseek-flash-latest",...}
```

### Cuidados não-óbvios

- **Não use Supabase CLI 2.110+** ao aplicar migrations (`db push`). O engine novo de migrations
  (effect/sql) quebra funções dollar-quoted e esconde o erro real do Postgres. Use versão estável
  (ex.: 2.34.3) para migrations.
- **Publishable key (`sb_publishable_...`)**: não é JWT. Sem `createSupabaseFetch`, o PostgREST
  responde `PGRST301` e a UI mostra "Erro ao verificar email".
- **Cookie JWT de outro projeto** (ex.: stack local antiga): quebra check-email/RPC com `PGRST301`.
  check-email ignora cookies; proxy limpa auth inválida. Hard refresh / limpar
  `sb-confere-auth-token*` se o browser ainda falhar.
- **Proxy `/supabase`**: não use rewrite do `next.config` (404 no App Router). O route handler
  deve filtrar hop-by-hop — senão "Failed to fetch" no login (senha).
- **`server-only`**: módulos de servidor (`lib/supabase/{admin,server,read-client,public-client}`,
  `lib/documents/*`, `lib/ai/*` exceto `schemas`/`usage`, `lib/auth/index`, `lib/security`,
  `lib/settings`) começam com `import "server-only"` — importar no client quebra o build.
  Componentes client usam apenas `*-shared.ts` e `lib/supabase/client`. O Vitest troca o pacote
  por um stub (`src/test/server-only.ts`). Guard: `src/lib/server-only.test.ts`.
- **`SUPABASE_INTERNAL_URL` vazio** quebra o proxy. Remova a linha ou deixe comentada.
- **`.env` na raiz é gitignored.** Não vem no clone — copie de `.env.example`.
  O Next carrega só o `.env` da raiz (`apps/web/next.config.ts`); não use `apps/web/.env.local`.
- **Não cole a publishable key na mesma linha do comentário** `# NEXT_PUBLIC_SUPABASE_ANON_KEY=`
  (vira `Invalid API key`).
- **Env vazio no processo** (`NEXT_PUBLIC_*=`) impede o `.env` de preencher a chave.
- **Grants RLS** (`private.*` → `authenticated`) são obrigatórios no cloud após o schema inicial.
- **Fireworks (padrão)**: `FIREWORKS_API_KEY` só no servidor. A API não aceita PDF — o pipeline
  renderiza as páginas em JPEG (`pdf-to-img`, 30 páginas/~7 MB) uma vez por análise e reusa nas
  4 tasks. Use o ID completo (`accounts/fireworks/routers/deepseek-flash-latest`); aliases curtos
  não funcionam. A migration `20261026142326_ai_fireworks_default.sql` força a config global para
  Fireworks e **já foi aplicada no cloud em 26/10/2026**; em outro ambiente, configure a chave
  antes de aplicar. Sem a chave, use `AI_PROVIDER=openrouter` ou o dropdown em `/configuracoes`.
  No Windows o `pdf-to-img` pode logar aviso de `standard_fonts` (caminho posix); PDFs com fontes
  embutidas convertem normalmente e no Linux/Vercel os assets estão no tracing.
  No deploy, `@napi-rs/canvas` **precisa** ser dependência direta e ter o import estático em
  `pdf-pages.ts`: o `pdfjs-dist` o requer em runtime e, sem isso, a função falha com
  `Cannot find module '@napi-rs/canvas'`. Não remova o import. O `pdf.worker.mjs` também precisa
  estar no `outputFileTracingIncludes` (fake worker do pdfjs no Node); o `next.config.ts` cobre
  `/api/ai/analyze` e `/api/ai/jobs/run`.
- **OpenRouter (opção)**: `OPENROUTER_API_KEY` só no servidor; `/api/ai/health` retorna 503 se a
  chave do provider ativo faltar e 401 sem sessão.
- **Fila de análise (`ai_jobs`)**: `POST /api/ai/analyze` grava o arquivo em
  `<tenant>/_jobs/<jobId>/`, cria o job e responde `202`; o processamento continua no
  `after()` da request. `/api/ai/jobs/run` (Bearer `CRON_SECRET`) drena jobs `queued` ou
  `running` travados há 15 min (até 3 tentativas) — aponte o Vercel Cron para ele.
- **Worker sem sessão**: `runWithAdminReads` (`lib/supabase/read-client.ts`) faz o pipeline do
  job ler via service role usando o `tenant_id` do job; requests normais seguem em RLS
  (`getReadClient`). Sem isso, `persistExtractionResult` falha no cron/`after()` por falta de
  cookie.
- **Consignee padrão**: `tenant_settings.default_consignee_party_id` (uma party do tenant) é
  vinculado a todas as importações pelo pipeline; o documento é comparado campo a campo e as
  divergências ficam em `imports.consignee_divergences` (o detalhe recalcula ao vivo). Configuração
  em `/configuracoes` (owner/admin); o notify continua por documento.
- **Painel `/admin` (super-admin)**: somente leitura, gate por `ADMIN_EMAILS` (`isSuperAdmin`),
  leitura cross-tenant via `createSupabaseAdminClient()` e auditoria em `audit_logs`
  (`action = admin.view_tenant`) no tenant do admin. **RLS intocada**; os módulos `lib/admin/*`
  são `server-only` e nunca devem ser importados no client. A conta em `ADMIN_EMAILS` enxerga
  dados de todos os tenants — mantenha MFA/2FA e o allowlist mínimo.
- **Observabilidade**: `src/instrumentation.ts` registra `@vercel/otel` (na Vercel envia para a
  observabilidade do projeto; local/testes viram no-op). `lib/observability/tracing.ts` expõe
  `withSpan`/`recordAiCall`: spans `ai.analyze`, `ai.job`, `ai.classify`, `ai.extract_*` e
  `ai.persist_extraction` + métricas `ai.call.duration|tokens|cost`. `OTEL_EXPORTER_OTLP_ENDPOINT`
  é opcional para exportar fora da Vercel.
- **Tipos do banco**: `lib/supabase/database.types.ts` é gerado do cloud (MCP
  `generate_typescript_types` ou `supabase gen types typescript --linked`) e tipa os cinco
  clients; regenere após cada migration. `knip.json` ignora o arquivo gerado. `MemberRole`
  segue o check do banco (`owner|admin|operator|viewer`) e claim desconhecido vira `viewer`.
- **Service role**: `SUPABASE_SERVICE_ROLE_KEY` obrigatória para `/api/ai/analyze`
  (grava Storage/`imports`/`documents`/`extraction_results`/`ai_logs` via admin;
  tenant_id sempre do JWT). Evita `permission denied for function current_tenant_id`
  quando os grants de `private.*` ainda não foram aplicados no cloud.
- **Consolidação de importações**: `(tenant_id, bl_number)` e `(tenant_id, invoice_number)`
  são únicos (índices parciais). Corrida no insert vira `23505` → releitura e reuso da
  importação vencedora; BL tem precedência sobre Invoice e uma chave já usada por outra
  importação não é copiada (`fillImportKeysIfEmpty` só descarta a coluna conflitante).
- **Merge/delete transacionais**: `public.merge_imports` e `public.delete_import` (RPCs
  `security invoker`, EXECUTE só para `service_role`) rodam em uma transação; o app chama via
  `admin.rpc`. `imports.status` inclui `failed`, marcado pelo pipeline quando a análise quebra.
- **Grants RLS** (recomendado): rode
  [`20250731190000_grant_private_rls_functions.sql`](supabase/migrations/20250731190000_grant_private_rls_functions.sql)
  no SQL Editor para selects autenticados com policies RLS funcionarem.
- **Dependências da raiz**: `next` e `typescript` no `package.json` raiz existem para o
  preview do v0 — não remover. O app usa as versões declaradas em `apps/web/package.json`.
