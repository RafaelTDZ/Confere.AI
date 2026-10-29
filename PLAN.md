# Plano — Confere.ia

Roadmap e estado atual do produto. Atualizado em out/2026.

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
- [x] **Infra Fireworks + OpenRouter** — clients servidor (`apps/web/src/lib/ai`), Fireworks como padrão (`accounts/fireworks/routers/deepseek-flash-latest`) e OpenRouter como opção; smoke autenticado `GET /api/ai/health`; PDF no Fireworks é convertido em imagens
- [x] **Upload + classificação + extração de chaves** — `POST /api/ai/analyze` enfileira (`ai_jobs`) e responde `202`; worker persiste `imports`/`documents` e extrai Invoice, número de Invoice explícito no Packing List e campos do BL
- [x] **Observabilidade** — `@vercel/otel` no `instrumentation.ts` + spans/métricas do pipeline em `lib/observability/tracing.ts`
- [x] **Painel admin global** — `/admin` somente leitura (super-admin): tenants, contadores, uso de IA e detalhe por tenant com auditoria em `audit_logs`
- [x] **Consignee padrão** — uma empresa do tenant vinculada a todas as importações; documento comparado e divergências (nome, CNPJ, endereço) exibidas na importação e no formulário de partes
- [x] **Rastreio de BL/container** — após extrair o BL, o pipeline enfileira o rastreio (`tracking_shipments`/`tracking_jobs`); Firecrawl consulta Maersk, MSC, CMA CGM, Hapag-Lloyd e COSCO, com timeline, ETA, navio/viagem, orçamento de créditos por tenant e fallback link/manual (`apps/web/src/lib/tracking`)
- [x] **Parse de PDF em markdown** — `POST /v2/parse` do Firecrawl converte o PDF (OCR quando necessário) em markdown antes das tasks de IA; o texto vira `TextPart` para todos os providers, com cache por `(tenant_id, sha256)` em `document_parses`, orçamento mensal de créditos e fallback para o pipeline de imagens/PDF quando o parse falha, vem curto ou estoura o teto (`docs/pdf-markdown.md`; `lib/ai/document-parse.ts` + migration `20261028150000_document_parse`) 

### Não implementado (UI ou backend)

- [ ] Extração de Packing List
- [ ] Comparação entre documentos (regras de negócio)
- [ ] Tela de revisão de divergências
- [ ] CRUD de produtos
- [ ] Detalhe / revisão de importação
- [ ] Testes automatizados
- [ ] Observabilidade (Sentry/OTEL configuráveis mas não integrados)

## Pendências — fluxo pós-extração (out/2026)

> Levantado em 28/10/2026 ao revisar o que acontece **depois** que a IA extrai e
> grava os dados. Nada aqui está implementado.

### 1. Conclusão da análise e o papel do botão "Salvar"

**Hoje:** a extração já persiste tudo (`documents`, `extraction_results`, `imports`)
e a importação fica em `awaiting_review` para sempre — **nenhum código grava
`completed`**. `PATCH /api/imports/[id]` apenas:

- sobrescreve o payload da extração mais recente (`overwriteLatestExtractionPayload`,
  **sem versionamento** — o resultado original da IA é substituído);
- atualiza `reference_number`/`supplier_name` e `invoice_number`/`bl_number`
  (conflito → `409` ou merge).

Não muda status, não reanalisa e não sincroniza o rastreio. Salvar sem editar
também reenvia o BL inteiro (`buildBlPayload`), gerando um write idêntico.

- [ ] Separar as duas intenções na UI:
  - **Salvar alterações** — aplica edições, sincroniza o rastreio e **não escreve
    quando o payload não mudou** (comparar antes do update).
  - **Concluir análise** — ação explícita: `imports.status = 'completed'`,
    `reviewed_at`/`reviewed_by` e registro em `audit_logs`; opcionalmente dispara
    o rastreio.
- [ ] Rota de conclusão (ex.: `POST /api/imports/[id]/complete`) com role
  owner/admin/operator e badge "Concluída" já existente em `IMPORT_STATUS_LABELS`.
- [ ] Decidir se a edição passa a **versionar** a extração (nova linha) em vez de
  sobrescrever a última.

### 2. Comparação entre documentos (núcleo do produto)

- [ ] Regras Invoice × Packing List × BL: volumes, peso bruto/líquido, cubagem,
  NCM, valor total, moeda/INCOTERM e partes.
- [ ] Persistir divergências em `analysis_results` e exibi-las na importação
  (hoje só existe comparação de **consignee** padrão).
- [ ] `product_matches` existe no schema e é movida no merge, mas **nada escreve
  nela**.

### 3. Rastreio — definição de produto (28/10/2026)

**Tela e acesso**

- [x] **Tela exclusiva** de rastreio (`/rastreio`): shipments do tenant com
  importação, armador, BL/container, status, ETA, último evento e próxima
  consulta; filtros por "em trânsito", "chegando (≤ 7 dias)", "sem ETA" e
  "sem consulta" (`lib/tracking/list.ts` + `app/(app)/rastreio/page.tsx`).
- [x] **Botão específico dentro da importação** (`/importacoes/[id]`): **apenas**
  o botão "Rastrear" dentro do card **"Dados do BL"** (o card do BL,
  à direita do título; o cabeçalho da página ficou só com back + título em
  29/10/2026) abre o detalhe do shipment principal
  (`/rastreio/<shipmentId>`, ordenação de `getPrimaryTrackingShipmentId` — alvo
  consultável antes de `link` e último evento mais recente, sem carregar
  timeline); sem rastreio na importação, cai para `/rastreio?import=<id>`. Como
  o card só é renderizado quando há BL (`hasBl`), não há botão sem BL. O
  `TrackingCard` foi removido da importação em 29/10/2026 (timeline, créditos e
  ações não são mais renderizados lá). O rastreio é acessado **pela importação**:
  não há item Rastreio na sidebar (removido em 29/10/2026), mas a rota
  `/rastreio` segue existindo.
- [x] **Cards recolhíveis no detalhe da importação**: "Dados do BL" e
  "Produtos" usam `components/ui/collapsible-card.tsx` e começam **fechados**
  (cabeçalho clicável com `aria-expanded`/`aria-controls`, chevron e hover
  sutil; o conteúdo só é montado quando aberto). O botão "Rastrear" fica no
  cabeçalho do card do BL, **fora da área de toggle**, então continua visível e
  clicável com o card recolhido. "Dados da importação" e "Documentos"
  continuam sempre abertos.
- [x] **Detalhe do shipment** (`/rastreio/[shipmentId]`): cabeçalho (armador,
  `BL`/`CNTR`, identificador, status e link da importação), cards **Shipment
  route**, **Timeline** e **Details**, tabela **Shipment milestones**
  (`DATE | STATUS | LOCATION | EVENT | TRANSPORT/VESSEL`), seletor de container
  entre os irmãos da importação e as **ações de rastreio** — "Atualizar"
  (`POST /api/imports/[id]/tracking/refresh`) e "Lançar evento manual"
  (`POST /api/imports/[id]/tracking/events`) em
  `components/tracking/tracking-actions.tsx`, com `router.refresh()` após
  sucesso e gating por `canEdit` (viewer não edita) (`lib/tracking/detail.ts` +
  `app/(app)/rastreio/[shipmentId]/page.tsx`).
- [x] **Atraso**: `tracking_shipments.eta_original` guarda o primeiro ETA do
  armador e `ata` a chegada real (evento de chegada/descarga); a Timeline mostra
  "No prazo", "Atrasado +X dias" ou "Adiantado −X dias".
- [x] **Mapa da rota**: Leaflet/OpenStreetMap **sem chave de API** no detalhe
  (`components/tracking/route-map.tsx` + `route-map-leaflet.tsx`, client com
  `dynamic(..., { ssr: false })`), com POL/POD geocodificados **no servidor**
  (`lib/tracking/geo.ts`, cache `port_geocodes`, Nominatim a 1 req/s) e fallback
  textual `POL → POD` quando falta coordenada de qualquer lado.

**Primeira consulta automática (preenche ETA)**

- [x] Assim que o BL é extraído, **rodar a busca na hora** (1 alvo no fim do
  pipeline, via `processQueuedTrackingJobs` com `importId`), em vez de só
  enfileirar como antes.
- [x] Preencher o **ETA** com o resultado e refletir na importação (o detalhe
  do shipment em `/rastreio/<shipmentId>` mostra o ETA;
  `tracking_shipments.eta`).
- [x] **Uma consulta por importação** (29/10/2026): BL e containers são o mesmo
  embarque. `buildTrackingTargets` deixa só um alvo consultável, nesta ordem:
  **BL do documento** quando tem o prefixo/formato do armador
  (`lib/tracking/bl-prefix.ts`), **BL master** (`masterBlNumber`) quando o BL é
  de casa e o master tem o prefixo (ou o armador foi inferido por ele) e, por
  fim, o **primeiro container válido** (os demais `link`); OOCL fica todo `link`
  (captcha) e provider sem suporte a container também (manual). Os shipments de
  todos os containers continuam existindo para exibição/evento manual.
  `enqueueTrackingForImport` reconcilia linhas antigas (rebaixa
  `http`/`firecrawl` para `link`, inclusive o BL de casa substituído pelo master,
  e encerra jobs `queued`).
- [x] **BL master de agente de carga** (29/10/2026): `masterBlNumber` entra no
  schema de extração do BL (`MASTER B/L`, `MBL NO.`, `OCEAN B/L`, `B/L MASTER`)
  com fallback determinístico no markdown, fica no payload da extração
  (editável como "BL master (MBL)") e é o alvo do rastreio quando o BL do
  documento é do forwarder. O detalhe do shipment rotula **BL master** quando o
  `query_value` difere de `imports.bl_number`.
- [x] Onde o ETA aterrissa: no **`eta` do payload do BL** (`extraction_results`),
  que já é o campo do formulário da importação (DD/MM/AAAA) — sem coluna nova em
  `imports`. O **alvo consultado** preenche (BL ou, na CMA/MSC, o primeiro
  container, que representa o embarque) e **somente quando o campo está vazio**
  (ETA extraído do documento ou edição manual nunca é sobrescrito). Containers
  `link` (fan-out) não preenchem. A opção (a) — nova coluna
  `imports.eta` + `eta_source`/`eta_updated_at` — foi **descartada**: exigiria
  migration e duplicaria a fonte do formulário.
- [x] **Fallback `not_found` do BL → 1º container** (29/10/2026): quando o BL é
  o alvo consultado e o armador responde `not_found` (ex.: BL de casa na HMM,
  `MSIRYOE261000021`), `fallbackToFirstContainer` promove o primeiro container
  `link` (`created_at asc`) para a estratégia do armador e o consulta **uma
  única vez**. O BL vira `link` (`next_check_at` nulo) e o ETA do container
  preenche o payload do BL (`fillBlEta`). Só roda quando **não** há outro
  container consultável, nunca a partir de um container e nunca com o BL
  `found`; falha do fallback é logada
  (`[tracking] fallback de container falhou:`) e engolida.
- [x] **Divergência de navio aceita (rollover/transbordo)** (29/10/2026):
  navio do portal diferente do BL **não** rejeita mais o snapshot. O resultado
  segue `found` com status/ETA/containers/eventos do portal — navio/viagem
  exibidos são os do portal e o BL permanece intacto — e recebe
  `vesselMismatch: { expected, found }` (persistido em
  `tracking_shipments.raw.snapshot`) + nota curta. O detalhe do shipment mostra
  o aviso "possível transbordo/rollover". Só **container divergente** continua
  rejeitado como "outro embarque"; o retry da Maersk não é mais disparado por
  divergência de navio (só `not_found` real). Caso real: OYH083, container
  `CMAU9481811` — portal CMA CGM SANTOS × BL CMA CGM ATLANTIC/SE3060W19.

**Cadência de consulta**

- [x] **Semanal por importação** (7 dias) e **diária quando faltar ≤ 7 dias** para
  o ETA. A cadência é aplicada por `tracking_shipments.next_check_at` — o cron
  diário já basta (Hobby permite 1 execução/dia); o filtro `next_check_at`
  decide quem é consultado.
- [x] Ajustar os defaults: `TRACKING_IN_TRANSIT_INTERVAL_MINUTES=1440` (1 dia) e
  `TRACKING_FAR_ETA_INTERVAL_MINUTES=10080` (7 dias); `nextCheckAtFor`
  (`lib/tracking/service.ts:158`) usa `daysUntil(eta) <= 7` como corte.
- [x] `not_found` segue 24h e erro/blocked segue backoff (máx. 24h).

### 3.1 Rastreio — lacunas técnicas confirmadas

Plano detalhado revisado em 28/10 (arquivo fora do repo:
`~/.opencode/plan/2026-10-28-fluxo-rastreio-bl.md`); resumo:

- [ ] **L1** `PATCH /api/imports/[id]` não sincroniza rastreio — corrigir
  BL/containers não cria alvos novos.
- [ ] **L2** Correção deixa alvo órfão (upsert `ignoreDuplicates` por
  `import_id, carrier_code, query_type, query_value`) e o principal continua o
  antigo (`getTrackingForImport`/`getPrimaryTrackingShipmentId` usam
  `created_at asc` como desempate). Trocar por ordenação semântica (alvo do BL
  atual primeiro).
- [ ] **L3** `merge_imports` não move `tracking_shipments`; o `delete` da origem
  derruba por cascade.
- [ ] **L4** `buildReusableResult` (caminho de cache/dedupe) não enfileira rastreio.
- [x] **Cron reenfileira por `next_check_at`**: `claim_tracking_jobs` só reserva
  jobs `queued`, então a cadência não se sustentava sozinha. O cron
  (`GET/POST /api/tracking/run`) chama `enqueueDueTrackingShipments` (lote 8)
  antes de `processQueuedTrackingJobs`: enfileira shipments com `next_check_at`
  nulo/vencido, `strategy` `http`/`firecrawl`, status não terminal e sem job
  `queued`/`running` (ordem `next_check_at asc nulls first`). Sem chamada
  externa no enqueue; crédito só é debitado no processamento.
- [ ] Prune de alvos obsoletos: preservar `source = 'manual'`, shipments com
  evento **e com job ativo**; decidir o que fazer com histórico de BL antigo.
- [x] **Refresh pela fila**: `refreshTrackingForImport` enfileira e processa
  **1** alvo via `processQueuedTrackingJobs({ importId, limit: 1, worker:
  "refresh" })`; o job é marcado `running` → `done`/`failed` e não sobra job
  `queued` órfão. `force` (botão) ignora `next_check_at`; sem `force`, só age
  quando o alvo está vencido (e não enfileira).
- [ ] `source` só aceita `scrape|manual` (check constraint) — distinguir `link`
  exige migration.

### 4. Qualidade de extração (guarda extra)

- [ ] Não persistir documento cujo payload não tenha o identificador mínimo
  (BL/Invoice sem `number`, Packing List sem `invoiceNumber`/produtos) — evita
  documento fantasma na importação.

## Schema do banco (existente, aguardando uso)

| Tabela | Propósito |
|--------|-----------|
| `tenants` | Empresas (multi-tenant) |
| `tenant_members` | Membros com role (owner/admin/operator/viewer) |
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
  ├─ /api/ai/health           → Fireworks/OpenRouter generateText (sessão obrigatória; chave só no servidor)
  └─ /api/ai/analyze          → cria job (202) → worker prepara o documento (PDF→imagens no Fireworks) e roda classificação/extração

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

Fireworks (padrão)            → routers deepseek-flash-latest e glm-flash-latest (FIREWORKS_API_KEY; PDF→imagens)
OpenRouter (opção)            → ~openai/gpt-luna-latest e meta/muse-spark-1.3 (OPENROUTER_API_KEY)
```

## Identidade visual

Status: **em implementação**. Modo escuro concluído (claro/escuro/sistema, sem flash); demais fases seguem a proposta.

- [`docs/design/identidade-visual.md`](docs/design/identidade-visual.md) — diagnóstico da UI, conceito de marca, tokens claro/escuro com contraste calculado, regras de componente, movimento e plano em fases.
- [`docs/design/preview.html`](docs/design/preview.html) — style tile autocontido (abrir no navegador) com paleta, tipografia, estados de botão, badge, input, tabela, navegação, timeline e estados.

Diagnóstico principal:

- Tokens são o tema padrão do shadcn/ui; não há cor de marca nem tokens de sucesso/aviso/info.
- Falhas de WCAG: badge `success` (branco sobre verde, 3,22:1) e `warning` (2,13:1); erro em texto (~3,8:1); borda de input (1,23:1).
- Modo escuro: tokens em `globals.css`, `ThemeProvider` + script no `<head>` (classe `dark`, preferência em `localStorage` `confere-theme`) e toggle na sidebar e no login. Detalhes em `docs/design/identidade-visual.md` (seção 4.9).
- Rastreio não aparece no menu lateral; o detalhe tem cabeçalhos em inglês.
- Sem `loading.tsx`, `error.tsx` nem `prefers-reduced-motion`.

Decisões pendentes (seção 8 do documento): cor de marca ("Azul Porto" `#1D4ED8` proposto), fonte (Inter), tamanho de texto de UI (14px, desvio da regra de 16px da skill), Rastreio no menu e "Produtos" no menu. (Modo escuro: ativado, com padrão do sistema.)

Validação visual pendente: o browser não estava conectado durante a análise, então a crítica foi feita por código. Conferir screenshots e contraste (axe/Lighthouse) antes de aprovar.

## Planos

- [`docs/planos/fireworks-default.md`](docs/planos/fireworks-default.md) — trocar o provedor padrão para Fireworks (DeepSeek/GLM via router) mantendo OpenRouter como opção; inclui PDF→imagens, migration e checklist de smoke.

## Referências

- [`README.md`](README.md) — setup, variáveis de ambiente, rotas
- [`AGENTS.md`](AGENTS.md) — instruções para agentes (auth)
- [`.env.example`](.env.example) — variáveis de ambiente
- [`supabase/migrations/`](supabase/migrations/) — schema do banco
