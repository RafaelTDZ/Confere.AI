# Rastreio de BL/container

Rastreia o embarque a partir do BL escaneado, usando o número do BL (ou o
**master** da consolidação, quando o BL do documento é do agente de carga) e,
como fallback, os containers extraídos (validados por ISO 6346). A consulta ao
armador é feita **uma única vez por importação**: BL e containers descrevem o
mesmo embarque, então só um alvo é consultável (o BL/master ou o primeiro
container).

## Fluxo

1. `analyze-pipeline.ts` persiste o BL (com o `masterBlNumber`, quando houver) e
   chama `enqueueTrackingForImport`.
   - Cria `tracking_shipments` para o BL e para até 3 containers válidos (8 na
     Evergreen), mas deixa **apenas um alvo consultável** (ver
     [Uma consulta por importação](#uma-consulta-por-importação)).
   - Enfileira `tracking_jobs` (idempotente: não duplica job ativo).
   - Em seguida roda a **primeira consulta na hora** (`processQueuedTrackingJobs`
     com `importId`, 1 alvo) para trazer o ETA junto com a análise.
   - Rastreio é acessório: qualquer erro aqui é logado e ignorado.
2. O processamento acontece em três caminhos:
   - **Primeira consulta**: ao fim da análise, escopada na importação. Sem
     `FIRECRAWL_API_KEY` ou com o orçamento estourado, o shipment fica `blocked`
     (a análise segue normal).
   - **Manual**: `POST /api/imports/[id]/tracking/refresh` (10/h por tenant).
     Aplica o **cooldown por importação** (`TRACKING_REFRESH_COOLDOWN_MINUTES`,
     padrão 30; ver [Cache curto do botão Atualizar](#cache-curto-do-botão-atualizar-cooldown)):
     consulta recente não é repetida nem com `force`. Enfileira e consome **1**
     job pela fila (`processQueuedTrackingJobs` com `importId`/`limit: 1`, worker
     `refresh`), então o job é marcado `running` → `done`/`failed` — não sobra
     job `queued` órfão. `force` (usado pelo botão) ignora `next_check_at`; sem
     `force`, o refresh só age quando o alvo está vencido e nem enfileira caso
     contrário.
   - **Cron**: `GET/POST /api/tracking/run` (Bearer `CRON_SECRET`). Antes de
     drenar, reenfileira até 8 shipments **vencidos** por `next_check_at`
     (`enqueueDueTrackingShipments`: nulo ou ≤ agora, `strategy` `http`/`firecrawl`,
     status não terminal e sem job `queued`/`running`) e então processa até 4 com
     claim atômico via `public.claim_tracking_jobs`. O claim aceita `queued`
     vencido **ou** `running` com lock expirado e `attempts < 3` (worker
     morto/timeout) e marca `failed` (`stale_timeout`) quem estourou o teto —
     sem isso o shipment ficaria "busy" para sempre. Containers `link` não entram
     (o filtro de estratégia os exclui). No plano Hobby da Vercel o cron é
     diário (06:00 UTC); para ciclo de 15 min use um cron externo
     (GitHub Actions/cron-job.org) chamando a rota.
3. O alvo consultável é consultado no portal do armador via Firecrawl
   (`https://api.firecrawl.dev/v2/scrape`), com `maxAge: 0`, `waitFor` de 8s e
   extração JSON (5 créditos). O resultado é normalizado em `tracking_events`
   (dedupe por `fingerprint`) e atualiza status/ETA/navio/viagem. Navio diferente
   do BL **não** invalida o resultado (rollover/transbordo): o snapshot é aceito
   com o navio/viagem do portal e a divergência sinalizada (`vesselMismatch` —
   ver [Divergência de navio](#divergência-de-navio-rollovertransbordo)). Quando
   o alvo é o BL **ou o primeiro container** (BL `link`), o ETA do armador
   também preenche o formulário da importação (ver
   [ETA no formulário do BL](#eta-no-formulário-do-bl)).
4. `not_found` no **BL** dispara o fallback aprovado: o **primeiro container
   válido** (ordem `created_at asc`, ainda `link`) é promovido para a estratégia
   do armador e consultado **uma única vez**. O BL passa a `link`, o container
   vira o alvo consultável da importação e o ETA dele preenche o formulário do
   BL (ver [Fallback: BL `not_found` → 1º container](#fallback-bl-not_found--1º-container)).
   Sem container válido, ou quando a importação já tem um container consultável,
   nada mais é consultado. Os containers seguem disponíveis para exibição, link
   do armador e evento manual.
5. Falha/limite → `blocked`/`error`, backoff exponencial (1h → 24h), link do
   armador e evento manual disponíveis na tela.

## Uma consulta por importação

- `buildTrackingTargets` escolhe **um** alvo consultável por importação, nesta
  ordem:
  1. **BL do documento**, quando o número tem o prefixo/formato do armador
     (`lib/tracking/bl-prefix.ts`). É o master emitido pelo armador: Maersk
     `MAEU`/`MRKU` (ou 9 dígitos), MSC `MEDU`/`MSCU`, CMA `CMDU`, COSCO `COSU`,
     Evergreen `EGLV` (ou 12 dígitos), Hapag `HLCU`, HMM `HMMU`, ONE `ONEY` e
     OOCL `OOLU`.
  2. **BL master** (`masterBlNumber`), quando o BL do documento é do agente de
     carga (sem o prefixo do armador) e o documento traz o número da
     consolidação. O shipment `query_type = 'bl'` passa a usar o número do
     master; o shipment antigo do BL de casa, quando já existir, fica `link`
     (histórico/exibição).
  3. **Primeiro container válido**, quando não há BL rastreável (BL de casa sem
     master, CMA/MSC, ou master também sem o prefixo). Os demais containers
     viram `link`.
  - Armador `unknown` não permite decidir (`looksLikeCarrierBl` → `true`), então
    o BL do documento continua sendo a consulta; se o portal não o conhecer, o
    fallback abaixo promove o primeiro container.
  - Quando o armador **não aceita consulta por container** (ou a estratégia é
    `link`, ex.: OOCL), BL e containers ficam `link` e o rastreio é manual pelo
    portal — nunca se promove um alvo que o provider não sabe consultar.
- Os shipments de todos os containers continuam criados para exibição e evento
  manual; só a estratégia muda (`link` = sem consulta automática, sem crédito).
- `enqueueTrackingForImport` reconcilia linhas antigas: qualquer alvo automático
  (`http`/`firecrawl`) que não seja o escolhido vira `link`, `next_check_at` fica
  nulo e jobs `queued` são encerrados (`single_query_target`). O escolhido é
  promovido se ainda estava `link` (ex.: armador corrigido de CMA para Maersk).
  Isso também cobre a troca do BL de casa pelo **master**: o shipment antigo com
  o número do documento vira `link` e não é mais consultado.
- O cron (`enqueueDueTrackingShipments`) filtra `strategy in ('http','firecrawl')`,
  então containers `link` nunca são reenfileirados.
- Quando o BL devolve os containers, `fanOutBlSnapshot` replica o snapshot e
  marca as linhas como `link` (sem scrape individual).

## Cache curto do botão "Atualizar" (cooldown)

- `refreshTrackingForImport` lê os alvos consultáveis da importação
  (`strategy in ('http','firecrawl')`) **antes** de enfileirar e compara o
  `fetched_at` com `TRACKING_REFRESH_COOLDOWN_MINUTES` (padrão **30**; `0`
  desativa).
- Dentro da janela, devolve
  `{ processed: 0, failed: 0, skipped: "cooldown", retryAfterSeconds }` e não
  consulta — **nem com `force: true`**. A rota responde **200** com esses campos
  (não é erro) e a UI mostra "Consulta recente — tente novamente em X min." em
  vez de "Rastreio atualizado.".
- O cooldown vale também quando a última consulta falhou (`not_found`/`error`):
  evita insistir em portal quebrado e pagar 5 créditos por tentativa. Alvo com
  `fetched_at` nulo (nunca consultado) segue o fluxo normal.
- Alvos `link`/`manual` não entram na conta (não houve consulta paga). O cron
  (`enqueueDueTrackingShipments` + `processQueuedTrackingJobs`) e a primeira
  consulta do pipeline **não** passam por esse caminho: obedecem à cadência
  normal (`next_check_at`).
- O rate limit de 10/h por tenant continua na rota e é consumido antes do
  cooldown; cliques bloqueados pelo cooldown também contam na janela.

## BL master (house BL de agente de carga)

- O BL emitido por agente de carga (forwarder/NVOCC) não existe no portal do
  armador. Muitos documentos trazem também o **BL master** da consolidação, que
  é rastreável e cobre o lote inteiro.
- Extração (`lib/ai/schemas.ts` + `lib/ai/tasks/extract-bl.ts`): o campo
  `masterBlNumber` procura `MASTER B/L`, `MBL NO.`, `OCEAN B/L` e `B/L MASTER`;
  é normalizado em maiúsculas e sem espaços. Quando a IA devolve `null`,
  `applyMarkdownFallbacks` (`lib/ai/bl-normalize.ts`) procura o mesmo rótulo no
  markdown do PDF (regex `MASTER`/`OCEAN B/L`/`MBL`), sem sobrescrever valor já
  extraído.
- O número do master fica no payload da extração do BL (não em `imports`) e o
  usuário pode corrigi-lo no formulário ("BL master (MBL)").
- No detalhe do rastreio (`/rastreio/[shipmentId]`), um shipment `query_type =
  'bl'` cujo `query_value` difere de `imports.bl_number` é rotulado como
  **BL master** (badge e seletor de irmãos), para não parecer outro embarque.

## Divergência de navio (rollover/transbordo)

- O navio informado pelo portal **não precisa** ser o do BL. Rollover e
  transbordo são legítimos (ex.: OYH083, container `CMAU9481811` no portal da
  CMA como **CMA CGM SANTOS**, enquanto o BL traz **CMA CGM ATLANTIC /
  SE3060W19**). `normalizeFirecrawlResult` (`lib/tracking/normalize.ts`) aceita o
  snapshot normalmente: `found`, status, ETA, containers e eventos preservados.
- A divergência só é sinalizada: `snapshot.vesselMismatch = { expected, found }`
  (`raw.expectedVessel` × navio do portal) e uma nota curta (`Navio no portal
  diferente do BL: <portal> × <BL>`, somada às `notes` do portal). Snapshots sem
  divergência (ou com o mesmo navio, ignorando caixa/pontuação) têm
  `vesselMismatch: null`.
- O navio/viagem **exibidos** são os do portal (persistidos em
  `tracking_shipments.vessel`/`voyage`); o BL permanece intacto. O
  `vesselMismatch` fica dentro de `tracking_shipments.raw.snapshot`
  (`persistSnapshot`) e o detalhe do rastreio mostra um aviso discreto:
  "Navio no portal diferente do BL (esperado X, encontrado Y) — possível
  transbordo/rollover".
- **Container divergente continua rejeitado** (`reportedContainers` sem o
  container consultado → `not_found`, "Resultado de outro container"): é o sinal
  mais forte de resultado de outro embarque. `error`/formato inválido seguem
  inalterados.
- O retry da Maersk (`attempts = 2`) não é acionado por divergência de navio:
  ele só existe para `not_found` real do portal (`maersk_no_result`).

## Fallback: BL `not_found` → 1º container

- Vale **só** quando o BL (do documento ou o **master**) é o alvo consultado
  (`query_type = 'bl'`), o snapshot foi persistido com sucesso e o status é
  `not_found` — caso típico do BL de casa que o portal não conhece (ex.: HMM com
  `MSIRYOE261000021`) ou do master que também não retornou dados.
- `fallbackToFirstContainer` (`lib/tracking/service.ts`) exige:
  - nenhum outro container consultável na importação (`strategy in
    ('http','firecrawl')`);
  - ao menos um container `link` (escolhe o primeiro por `created_at asc`);
  - `carrierSupportsContainer(carrier_code)` — provider que não aceita container
    não promove nada (fica manual).
- O container é promovido para `trackingStrategyForCarrier(<carrier_code>)`
  (`http`/`firecrawl`) com `next_check_at = null` e processado **uma vez** por
  `processShipment` (sem job novo, sem sobra na fila). O BL e os demais alvos
  automáticos viram `link` com `next_check_at = null`: a importação continua com
  **um** alvo consultável.
- `fillBlEta: true` já é o padrão de `processShipment`, então o ETA do container
  preenche o `eta` do payload do BL (somente se estiver vazio).
- Nunca dispara a partir de um container (sem recursão) e nunca roda quando o BL
  voltou `found`/`in_transit`/outro status.
- Falha do fallback (erro/`not_found`/`blocked`) é logada
  (`[tracking] fallback de container falhou:`) e engolida: o BL já persistido e
  o job seguem como `done`. Se o scrape falhar antes de persistir, o container
  permanece promovido e o cron tenta de novo na cadência.

## ETA no formulário do BL

- O ETA visível na importação é o campo `eta` do **payload do BL** em
  `extraction_results` (renderizado pelo formulário via `BL_DATE_FIELDS`, em
  DD/MM/AAAA). `imports` **não** tem coluna de ETA — a opção de criar
  `imports.eta` + `eta_source` foi descartada.
- `persistSnapshot` chama `fillBlEtaFromTracking` para o **alvo consultado** —
  o BL, o primeiro container quando o BL é `link` (CMA/MSC) ou o container
  promovido pelo fallback de BL `not_found` — e somente quando o snapshot traz
  `eta`. Containers `link` (fan-out) não preenchem: o ETA do embarque já veio do
  alvo único.
- A gravação acontece apenas se `payload.eta` estiver nulo/vazio: ETA extraído do
  documento ou editado pelo usuário nunca é sobrescrito.
- Usa o **client admin** (`createSupabaseAdminClient`) porque cron/worker não têm
  sessão nem `runWithAdminReads`; busca os `documents` do tipo
  `bill_of_lading` da importação e grava na `extraction_results` mais recente
  (`created_at desc`) do tenant.
- A data vem do snapshot em ISO (`YYYY-MM-DD`) e é convertida sem `Date`/
  timezone para `DD/MM/AAAA`.
- Qualquer falha é logada (`[tracking] falha ao preencher ETA do BL`) e **não**
  derruba o processamento: `tracking_shipments` já foi atualizado e o job segue
  como `done`.
- Shipment `link` não consulta, então nada muda nele.

## Tela de rastreio (`/rastreio`)

- **Lista do tenant**: `lib/tracking/list.ts` → `listTenantTracking({ tenantId,
  importId?, filter?, limit? })` lê `tracking_shipments` com `getReadClient`
  (RLS), ordena pelo último evento (mais recente primeiro; sem evento no fim) e
  resolve a importação em **uma** consulta `in` em `imports` — sem N+1. A
  referência usa `displayImportReference` com fallback para `bl_number`.
- **Colunas**: importação (link para `/importacoes/[id]`), armador (rótulo de
  `CARRIERS`), BL/container (`TRACKING_QUERY_LABELS` + número), status
  (`trackingStatusLabel`), ETA em DD/MM/AAAA com "em X dias"/"há X dias",
  último evento e próxima consulta (`trackingNextCheckLabel`: data agendada,
  "Concluído" só em status finais e "Aguardando consulta" nos demais sem
  `next_check_at`). Em viewports estreitas a tabela rola na horizontal
  (`overflow-x-auto`, `min-w-[980px]`) em vez de cortar as últimas colunas.
- **Resumo**: total, em trânsito (`in_transit`/`transshipment`), chegando (ETA
  em até 7 dias, incluindo atrasado, exceto status finais) e sem ETA. Os
  contadores respeitam o escopo (`?import=`), mas não o filtro ativo.
- **Filtros como links** (`?filtro=todos|transito|chegando|sem_eta|sem_consulta`),
  sem JavaScript no client. `sem_consulta` cobre `fetched_at` nulo e shipment
  não terminal sem `next_check_at`.
- **Acesso pela importação**: a importação (`/importacoes/[id]`) tem **somente o
  botão** "Rastrear" dentro do card **"Dados do BL"** (o card do BL,
  alinhado à direita do título) → detalhe do shipment principal
  (`/rastreio/<shipmentId>`, ordenação de `getPrimaryTrackingShipmentId`: alvo
  consultável antes de `link`, último evento mais recente e empate pela ordem de
  criação); sem rastreio na importação, cai para `/rastreio?import=<id>`. O
  cabeçalho da página não tem mais o botão (29/10/2026) e o card só existe
  quando há BL (`hasBl`), o que é coerente com o rastreio. O card
  **"Dados do BL"** (como o card **"Produtos"**) é **recolhível e nasce
  fechado** (`components/ui/collapsible-card.tsx`): o cabeçalho inteiro é o
  toggle (botão com `aria-expanded`/`aria-controls` e chevron) e o "Rastrear"
  fica **fora da área clicável**, no lado direito do cabeçalho — continua
  visível e clicável com o card recolhido. O card
  de rastreio foi **removido da importação** (29/10/2026): timeline, créditos e
  ações vivem na tela de detalhe. A tela de lista mostra um chip com a referência
  e um link para limpar o escopo (mantendo o filtro). **Não há item Rastreio na
  sidebar** — a rota `/rastreio` existe para acesso direto e links. Cada
  identificador da lista linka para o detalhe daquele shipment.
- A página é `force-dynamic` (dados por tenant/RLS e `searchParams`), com estados
  vazios distintos para "nenhum rastreio", "importação sem rastreio" e "nenhum
  resultado no filtro".

## Detalhe do shipment (`/rastreio/[shipmentId]`)

- **Dados**: `lib/tracking/detail.ts` → `getTrackingShipmentDetail({ tenantId,
  shipmentId })` lê via `getReadClient` (RLS) e filtra `tenant_id` em todas as
  consultas. Shipment de outro tenant é tratado como inexistente
  (`TrackingShipmentNotFoundError` → `notFound()`).
- **Cabeçalho**: armador (`carrierLabelFor`), tag `BL`/`BL master`/`CNTR`,
  identificador, badge de status e link "Abrir importação"
  (`/importacoes/<id>`). A tag vira **BL master** quando o `query_value` do
  shipment `bl` difere do `imports.bl_number` (BL do documento).
- **Shipment route**: POL/POD (cidade + país) e data de embarque vêm da extração
  mais recente do `bill_of_lading` (`polCity`/`polCountry`/`podCity`/
  `podCountry`/`onboardDate`). A saída cai para o primeiro evento quando o BL
  não traz `onboardDate`; a chegada usa `ata ?? eta`.
  `components/tracking/route-map.tsx` desenha o mapa Leaflet (ver
  [Mapa da rota](#mapa-da-rota-pol--pod)); sem as duas coordenadas, mantém o
  traçado textual `POL → POD` com as datas.
- **Timeline**: ETA, ATA e atraso — `(ata ?? eta) - eta_original`, exibido como
  `No prazo`, `Atrasado +X dias` ou `Adiantado −X dias`.
- **Details**: containers (shipment, BL, irmãos e eventos), número de eventos de
  transbordo e tempo de trânsito (primeiro evento → chegada; fallback
  `onboardDate → eta`). Navio/viagem vêm do shipment e caem para
  `payload.vessel`/`payload.voyage` do BL mais recente quando o armador não os
  informa. Quando `raw.snapshot.vesselMismatch` existe, um aviso discreto acima
  das ações mostra "Navio no portal diferente do BL (esperado X, encontrado Y) —
  possível transbordo/rollover"; o layout (`flex-wrap`/`min-w-0`) não muda.
  "Próxima consulta" usa `trackingNextCheckLabel`: só é "Concluído"
  em status final; shipment ativo sem `next_check_at` mostra "Aguardando
  consulta". O cabeçalho usa `flex-wrap`/`min-w-0`, então o botão "Abrir
  importação" desce de linha em vez de ser cortado em ~1024px.
- **Shipment milestones**: `tracking_events` ordenados por `event_at desc` em
  `DATE | STATUS | LOCATION | EVENT | TRANSPORT/VESSEL`.
- **Seletor de container**: os irmãos da mesma importação viram links para
  `/rastreio/<shipmentId>` (o shipment atual fica marcado no botão).
- **Ações** (`components/tracking/tracking-actions.tsx`): "Atualizar" (POST
  `/api/imports/[id]/tracking/refresh`) e "Lançar evento manual" (POST
  `/api/imports/[id]/tracking/events`, validação pura em
  `lib/tracking/manual-event.ts`) ficam **no detalhe do shipment**, com
  `router.refresh()` após o sucesso e feedback de erro/loading. `canEdit`
  (`role !== "viewer"`) desabilita as ações; as rotas também respondem 403 para
  viewer.
- A página é `force-dynamic`.

## Mapa da rota (POL → POD)

- **Componente**: `components/tracking/route-map.tsx` é client e carrega o mapa
  Leaflet via `dynamic(..., { ssr: false })`
  (`components/tracking/route-map-leaflet.tsx`), porque o Leaflet usa `window`
  no import. O CSS (`leaflet/dist/leaflet.css`) é importado no próprio
  componente dinâmico — o App Router coloca o CSS no chunk do mapa.
- **Mapa**: tiles do OpenStreetMap (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`)
  com atribuição “© OpenStreetMap contributors”, **sem chave de API**. Os
  marcadores POL/POD usam `CircleMarker` (SVG, sem depender das imagens padrão
  do Leaflet) e são ligados por uma `Polyline`; `fitBounds` enquadra os dois
  pontos. `scrollWheelZoom` fica desligado para a roda não capturar o scroll da
  página. Altura fixa (`h-72 md:h-96`) e borda/rounded iguais aos cards.
- **Fallback**: sem as **duas** coordenadas (BL sem cidade/país, geocode nulo,
  timeout etc.) o bloco mantém o traçado textual `POL → POD` com as datas —
  nunca renderiza um mapa quebrado.
- **Geocodificação** (`lib/tracking/geo.ts`, server-only): a consulta é
  normalizada (`"  Itapoá ,  Brasil "` → `"itapoa, brasil"`: minúsculas, sem
  acentos, espaços colapsados, `cidade, país`), lida do cache
  `public.port_geocodes` e, no miss, consultada no Nominatim
  (`/search?format=jsonv2&limit=1&q=...`). O cache é gravado **só em sucesso**
  (`upsert on conflict do nothing`). A página resolve POL e POD **em sequência**
  (`resolveRouteCoordinates`) e o browser nunca chama o Nominatim.
- **Política do Nominatim**: `User-Agent` identificável (`GEOCODE_USER_AGENT`),
  no máximo **1 requisição/segundo** (fila no módulo, inclusive entre requests
  simultâneos da mesma instância), timeout de 3s e cache agressivo por consulta.
  Falha de rede/limite/JSON inválido devolve `null` e não derruba a tela; nenhum
  endereço completo vai para o log.
- **Acesso**: `port_geocodes` tem RLS habilitada **sem policies**; leitura e
  escrita passam só pelo service role (`createSupabaseAdminClient`). Sem a
  chave, o geocode falha em silêncio e o card usa o fallback textual.
- **Envs**: `GEOCODE_BASE_URL` (padrão `https://nominatim.openstreetmap.org`) e
  `GEOCODE_USER_AGENT` (padrão `confere-ia/1.0`). Ao trocar de provedor,
  mantenha o contrato de 1 req/s e o UA identificável.

## Atraso (ETA original x chegada real)

- `tracking_shipments.eta_original` recebe o **primeiro ETA** devolvido pelo
  armador, somente quando ainda está nulo (`persistSnapshot` →
  `persistTrackingMilestones` em `lib/tracking/service.ts`).
- `tracking_shipments.ata` recebe a data do marco de chegada/descarga mais
  recente (`arrived`/`discharged`, "chegada", "descarregado"...), ignorando
  eventos futuros e descrições de previsão ("estimated", "planned"). Não é
  sobrescrito depois de preenchido.
- Falha na gravação dos marcos é logada (`[tracking] falha ao gravar marcos do
  embarque`) e **não** derruba o rastreio: o snapshot principal segue
  normalmente (mesmo padrão do ETA do BL).

## Armadores

| Armador | Código | Portal | Observação |
|---|---|---|---|
| Maersk | `maersk` | `/tracking/{número}` | SPA atrás do Akamai: exige `proxy: stealth` e ~18s. O BL retorna os containers; o retry (`attempts = 2`) vale só para `not_found` real, nunca para divergência de navio. |
| MSC | `msc` | `/api/feature/tools/TrackingInfo` | **API JSON gratuita** (0 créditos) com cookie de sessão. BL de casa (forwarder) não existe na MSC → `link`; só o primeiro container é consultado (os demais `link`). |
| CMA CGM | `cma` | `/ebusiness/tracking` | Formulário POST: o scraping abre a página base e preenche `#Reference` (`actions`). BL de casa (forwarder) não é reconhecido — o rastreio efetivo é pelo primeiro container (os demais `link`). |
| Hapag-Lloyd | `hapag` | `track-by-container-solution.html` / `track-by-booking-solution.html` | Formulário AEM (`hl12`/`hl16` + `hl25`/`hl18`) via Firecrawl `actions`, ~12s. Em 28/10/2026 o portal estava **em manutenção**; BL de casa (não `HLCU`) fica `link` e só o primeiro container é consultado. |
| COSCO | `cosco` | `/scct/public/ct/base` | SPA nova: `trackingType=blNumber\|containerNumber\|bookingNumber` + `number` na URL, ~14s. O BL devolve os containers; o fan-out evita consultas individuais. |
| OOCL | `oocl` | `oocl.com/.../cargotracking.aspx` | Portal com **captcha da CargoSmart**: v1 usa `link` + evento manual (sem rastreio automático). |
| HMM | `hmm` | `hmm21.com/e-service/general/trackNTrace` | **API interna** (0 créditos) com sessão + CSRF. BL com prefixo `HMMU` é a fonte autoritativa (container `link`); BL de casa sem master cai para o primeiro container, porque a API aceita `cntr`. |
| ONE | `one` | `one-line.com/one-ecom/manage-shipment/cargo-tracking` | **API interna** `ecomm.one-line.com/api` (0 créditos, sem captcha). BL `ONEY` é autoritativo e o container fica `link` (recarga); BL de casa sem master cai para o primeiro container (`CNTR_NO`). |
| Evergreen | `evergreen` | `ct.shipmentlink.com/servlet/TDB1_CargoTracking.do` | Formulário POST (`#s_bl`/`#s_cntr` + `#NO`). O BL retorna todos os containers; o serviço replica o resultado e não consulta container por container. |

O reconhecimento usa o campo `carrier` do BL (`lib/tracking/carriers.ts`) e,
quando ele não identifica, o prefixo do **master** BL (`lib/tracking/bl-prefix.ts`).
Armador desconhecido não permite decidir se o BL é de casa: o BL do documento
continua sendo a consulta e o fallback de `not_found` promove o primeiro
container. Para a CMA, o alvo de BL é criado como `link` (sem custo) porque o BL
emitido por forwarder não é rastreável no portal; o primeiro container é a
chave (os demais ficam `link`).

Validado em 27/10/2026 com um BL real (CMA CGM KRYPTON, Shekou → Itapoá):
`actions` preenchendo `#Reference` → 2 eventos, ETA 02/11/2026, status
`in_transit`.

Também validado com Evergreen (BL `143600393412`, SEASPAN YINGKOU,
Xingang → Itapoá): o formulário (`#s_bl` + `#NO`) retorna os 5 containers de
uma vez; o serviço replica o snapshot para as linhas de container e evita
consultas individuais.

MSC validada pela API interna (containers `MSMU4775369` e `TIIU4085593`,
MSC STELLA M X / QI633A, ETA 01/11/2026): 2 containers, 12 eventos e **0
créditos** de Firecrawl. O BL de casa `PLIQD4H06868` retorna “No results found”
e fica como `link`. Com a regra de uma consulta por importação, só o primeiro
container (`MSMU4775369`) é consultado e os demais ficam `link`.

Maersk validada com o BL `276430227` (SAN NICOLAS MAERSK / 639W, ETA
14/11/2026, container `MMAU1421499`): o portal exige `proxy: stealth` e ~18s;
o BL devolve containers/eventos. Divergência de navio é aceita e sinalizada
(rollover/transbordo); o retry de 5 créditos extras só acontece quando o portal
devolve `not_found` real. Custo normal: 5 créditos.

COSCO validada com o BL `COSU6508676460` (COSCO SHIPPING PERU / 009W, ETA
24/09/2026, container `GAOU7393528`): a SPA nova
(`/scct/public/ct/base?trackingType=blNumber&number=...`) busca sozinha; o
container aparece como **Empty Return** em 05/10 e o fan-out cobre a linha do
container. Custo: 5 créditos.

OOCL não pôde ser automatizada: o portal usa captcha da CargoSmart e a busca
retorna sem dados em browser headless. Fica como `link` + evento manual
(portal `oocl.com/.../cargotracking.aspx`). Para automatizar, seria necessário
um provedor pago (Terminal49/Vizion/ShipsGo) ou credencial da CargoSmart.

HMM validada pela API interna (`fetchHmmTracking`, 0 créditos) com o BL
`TSNM72593800`: ONE PREMIUM / 0092W, ETA 22/07/2026, container `KOCU4320185`,
16 eventos até `Import Empty Container Returned` (28/07/2026). O BL devolve os
containers e o fan-out cobre a linha do container (que pode ter sido recarregado
em outro embarque, por isso não é consultado individualmente). Como `TSNM` não
casa com o prefixo `HMMU`, pela regra atual esse número seria tratado como BL de
casa/master e o primeiro container assumiria a consulta.

ONE validada pela API interna (`fetchOneTracking`, 0 créditos) com o BL
`ONEYSZPGC3008300`: YM MODERATION / 083W, transbordo em Singapura para ONE
PREMIUM / 092W, ETA 21/07/2026, container `TCKU7925277`, 12 eventos até
`Empty returned` (01/08/2026). O container também fica `link` (recarga).

Hapag-Lloyd: formulário AEM implementado e submetido com sucesso, mas o portal
estava **em manutenção** em 28/10/2026 (“back at 07:30 UTC on 2026-10-24”), então
não foi possível validar a timeline. O BL de casa `SASE3388881` (forwarder YQN)
vira `link`; a Hapag é inferida pelos containers `HLBU...` e o container
`HLBU9334723` é consultado. Quando o portal voltar, o adapter já está pronto;
o card oferece o link e o evento manual enquanto isso.

## Variáveis

```env
FIRECRAWL_API_KEY=
TRACKING_FIRECRAWL_MONTHLY_CREDITS=3000
TRACKING_FIRECRAWL_GLOBAL_CREDITS=9000
TRACKING_CARRIER_STRATEGY=
TRACKING_IN_TRANSIT_INTERVAL_MINUTES=1440
TRACKING_FAR_ETA_INTERVAL_MINUTES=10080
TRACKING_CONTAINER_FALLBACK_LIMIT=3
TRACKING_REFRESH_COOLDOWN_MINUTES=30
GEOCODE_BASE_URL=https://nominatim.openstreetmap.org
GEOCODE_USER_AGENT=confere-ia/1.0 (contato@confere.ai)
```

Cadência efetiva (`nextCheckAtFor`): **semanal (7 dias)** por importação e
**diária** quando faltar **≤ 7 dias** para o ETA (`daysUntil(eta) <= 7`).
`not_found` mantém 24h e erro/blocked usa backoff exponencial (1h → máx. 24h),
com jitter de até 10%. O botão "Atualizar" não usa a cadência: aplica o
cooldown curto de `TRACKING_REFRESH_COOLDOWN_MINUTES` (padrão 30; `0` desativa)
sobre o `fetched_at` do alvo consultável.

Quem materializa a cadência é o cron: `enqueueDueTrackingShipments` roda antes
do processamento e cria `tracking_jobs` para os shipments cujo `next_check_at`
nulo/vencido, ignorando `link`/`manual`, status terminais (`delivered`,
`empty_returned`) e quem já tem job `queued`/`running`. O enqueue não faz
chamada externa nem consome crédito — o orçamento só é debitado no scrape.

Custo aproximado: `importações ativas × ciclos/mês × 30 × 5 créditos` (v1 usa
extração JSON). No ciclo semanal (~4 consultas/mês) 30 importações custam
~600 créditos/mês; cada importação nos 7 dias finais soma ~7 consultas
(~35 créditos). A primeira consulta após a análise gasta **1 scrape por
importação** — BL, ou primeiro container quando o BL é `link` — (5 créditos; 0
nos armadores com API interna). Por isso o padrão de 3.000 por tenant. O modo
`markdown` (1 crédito) exige parser determinístico por armador e ainda não está
implementado.

## Operação

- **Sem chave**: shipments ficam `blocked` com `firecrawl_not_configured`; a
  análise continua normal.
- **Orçamento esgotado**: `blocked`/`budget_exhausted`; zere
  `TRACKING_FIRECRAWL_MONTHLY_CREDITS` para desligar o rastreio automático.
- **Armador mudou o layout**: rode o spike com um BL real, atualize o schema em
  `tracking-schema.ts` ou mova o armador para `markdown` + parser dedicado.
- **Muitos `not_found`**: confira se o BL extraído está correto e se o armador
  aceita BL (alguns só aceitam container/booking).
- **429/402**: o job volta para a fila com backoff; não reprocesse em loop.

## Proteções contra loops e consumo

Auditoria das travas que impedem rajadas/loops nas chamadas pagas (Firecrawl de
rastreio e de parse, e modelo de IA). Legenda de gap: **—** = coberto;
**baixo** = risco residual aceitável; **real** = vale correção.

| Proteção | Onde | Gap real |
|---|---|---|
| Rate limit de refresh: **10/h por tenant** | `app/api/imports/[id]/tracking/refresh/route.ts` | Baixo: é por tenant (usuários do mesmo tenant somam 10/h) e cliques barrados pelo cooldown também consomem a janela. |
| **Cooldown por importação**: `fetched_at` + `TRACKING_REFRESH_COOLDOWN_MINUTES` (padrão 30, `0` desativa), inclusive após falha e com `force` | `refreshTrackingForImport` (`lib/tracking/service.ts`) + `lib/tracking/config.ts` | — (novo; cobre o clique repetido no mesmo alvo). |
| Orçamento mensal **tenant** (atômico) e **global** (pré-checagem) | `lib/tracking/usage.ts` + RPC `consume_tracking_credits` | Real (baixo impacto): o RPC só recebe `p_limit` do tenant; o teto global é checado no app antes do RPC e pode estourar sob concorrência entre tenants. |
| Lock otimista de **10 min** no shipment | `processShipment` | Baixo: se a function morrer, o lock expira sozinho em 10 min. |
| **Claim atômico** de jobs (`for update skip locked`) + lotes (cron reenfileira 8, processa ≤ 4; refresh 1) | `claim_tracking_jobs` (migration `20261029120000_tracking_stale_jobs.sql`), `/api/tracking/run`, `processQueuedTrackingJobs` | —: o claim aceita `queued` vencido **ou** `running` com `locked_until < now()` e `attempts < 3`; quem estourou o teto vira `failed` (`stale_timeout`) e o shipment volta a ser enfileirado. O claim escopado por importação (TS) aplica o mesmo critério. |
| Backoff + `next_check_at` com jitter de 10% | `nextCheckAtFor` | — para o cron (24h em `not_found`, 1h→24h em erro); o botão ignora de propósito e agora é limitado pelo cooldown. |
| **1 alvo consultável por importação** (BL ou 1º container) | `buildTrackingTargets` + reconciliação em `enqueueTrackingForImport` | — (containers `link` não são consultados nem pelo cron nem pelo botão). |
| **Fallback único** BL `not_found` → 1º container (1 tentativa, sem recursão) | `fallbackToFirstContainer` | Baixo: falha é logada e engolida; o container promovido continua consultável na cadência. |
| Timeout dos providers: Firecrawl 60s (+5s de abort), MSC/HMM 20–30s, ONE 30s | `lib/tracking/firecrawl.ts`, `lib/tracking/providers/*` | Baixo: `maxDuration = 120` no refresh cobre o pior caso do Firecrawl (65s) com folga; o cron segue com 60s para 4 jobs de ~13s. Se a function morrer mesmo assim, o claim recupera o job `running` órfão. |
| Evento manual com dedupe por `fingerprint` | `/api/imports/[id]/tracking/events` | Baixo: sem rate limit, mas é escrita barata e idempotente. |
| Rate limit de análise: **30/h por tenant** | `app/api/ai/analyze/route.ts` | Baixo: **fail-open** se o RPC do limiter falhar; conta upload (não chamada de modelo). Reenvio do mesmo arquivo é deduplicado (`findReusableUpload`) e não gasta Firecrawl/modelo. |
| Quota mensal de **10M tokens** por tenant (`ai_logs`) | `app/api/ai/analyze/route.ts` | **Real (médio)**: checada só no enqueue e **fail-open**; um job aceito pode ultrapassar a quota. `/api/ai/health` não grava `ai_logs` (não entra na quota), mas tem rate limit próprio. |
| Timeout de **90s** por task + **1 retry só em timeout** (env `AI_TASK_TIMEOUT_MS`/`AI_TASK_RETRIES`, máx. 3) | `lib/ai/task-timeout.ts` + tasks | Baixo: o SDK de IA não tem `maxRetries` fixado no projeto (usa o default), então 429/5xx podem multiplicar tentativas dentro de cada retry da task. |
| Fila `ai_jobs`: claim atômico, **attempts ≤ 3**, recuperação de `running` travado há **15 min**; `failed` é terminal | `ai-jobs.ts`, `ai-worker.ts`, RPC `claim_next_ai_job` | — (sem loop de retry infinito). |
| Dreno da fila: **3 jobs/execução**, teto de **240s** (função 300s) | `app/api/ai/jobs/run/route.ts` | — |
| Polling do cliente: **170 × 2s (340s)** e para em sucesso/falha | `components/analise/upload-dropzone.tsx` | Baixo: `GET /api/ai/jobs/[id]` é leitura por RLS, sem rate limit (barato). |
| Smoke de IA autenticado | `app/api/ai/health/route.ts` | —: **20/h por tenant** (`ai:health:<tenant>`, `consumeRateLimit`, 429 + `Retry-After`, fail-open no limiter); `401` sem sessão e `503` sem chave continuam antes do bucket. Não grava `ai_logs` (diagnóstico não consome quota). |
| Cache de parse por `(tenant, sha256)` | `lib/documents/document-parses.ts` | Baixo: uploads simultâneos do mesmo arquivo podem passar os dois antes do cache (parse duplicado). |
| Orçamento de parse por tenant (`DOCUMENT_PARSE_MONTHLY_CREDITS`, `0` = sem teto) | `lib/ai/document-parse.ts` | **Real (baixo)**: pré-checagem seguida de `consumeDocumentParseCredits`; quando o consumo falha o documento é processado mesmo assim (overshoot de 1 documento). Não há teto global de parse. |
| Parse: timeout de **90s**, **30 páginas**, sem retry, e falha cai para imagens/PDF | `lib/ai/document-parse.ts` + `prepareDocument` | — (parse é acessório: nunca derruba a análise). |

**Gaps priorizados**

1. **Teto global de rastreio não atômico** e **overshoot do orçamento de
   parse**: mover a checagem global para o RPC/uma quota por período e só
   processar o parse quando `consumeDocumentParseCredits` confirmar.
2. **`maxRetries` do SDK de IA não fixado**: declarar o valor no client para o
   pior caso de tentativas ser previsível.

## Pendências conhecidas

- Fixtures reais por armador (a validação depende de um BL/container real).
- Adapters `http` (1 crédito) para os armadores que expõem JSON público.
- Validar o caminho feliz dos demais armadores (Maersk, MSC, Hapag, COSCO) com BLs reais; a CMA já foi validada.
- `bookingNumber` na extração do BL (alguns portais só rastreiam por booking).
- Badge de rastreio na lista `/importacoes` e notificações de mudança de status.

## Termos de uso

O acesso automatizado aos portais é responsabilidade do operador da conta.
Mantenha o volume baixo, identifique-se quando possível e desative um armador
via `TRACKING_CARRIER_STRATEGY` se o portal proibir scraping.
