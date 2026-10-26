# Plano — Fireworks como provedor padrão

> **Status:** plano revisado em 26/10/2026 contra o código atual (pós AI-01/DATA-01/DATA-03/OBS-03).
> Ajustes em relação ao rascunho original estão marcados com **Revisão**.
>
> **Implementação (26/10/2026):** fases 1 e 2 concluídas no commit `03f00e6`
> (`feat(web): adicionar Fireworks e conversao de PDF`) — provider/catálogo/settings/UI,
> PDF→imagens (`pdf-to-img`), pipeline/tasks, tracing do Next e testes (699). A migration
> `20261026142326_ai_fireworks_default.sql` foi **aplicada no cloud** (23/23) e `app_settings`
> está `fireworks` + router DeepSeek. `FIREWORKS_API_KEY` configurada no `.env` local (gitignored).
> Smoke direto via AI SDK com a chave real: `Output.object` OK, visão OK (imagem → `12345`) e
> múltiplas imagens OK (duas páginas somando `24690`); routers DeepSeek e GLM responderam.
> Smoke E2E pela UI em 26/10/2026: upload de PDF → job `succeeded` (1 tentativa) → importação
> `awaiting_review` com invoice `12345`/supplier `Fireworks Test`; `ai_logs` com `classify`
> (2,0s) e `extract_invoice` (2,5s). O artefato de teste foi removido (DB + Storage).
> Pendente: configurar `FIREWORKS_API_KEY` na Vercel.

## 0. Verificação técnica (26/10/2026)

### Confirmado no código/banco

- `apps/web/src/lib/ai/provider.ts` aceita só `openrouter`; `getAiProvider` ignora overrides.
- `catalog.ts` só tem OpenRouter; `ai-settings.ts` valida `z.enum(["openrouter"])` e reporta só
  `openrouterConfigured`; o form envia `provider: "openrouter"` fixo.
- Tasks montam PDF como `FilePart` e usam plugins do OpenRouter (`file-parser`, `response-healing`).
- `app_settings`: constraint `provider = 'openrouter'` e linha `ai` =
  `openrouter` / `~openai/gpt-luna-latest`.
- `provider.test.ts` e `catalog.test.ts` **já existem** (o plano original os tratava como novos).
- `pdf-to-img@7.0.1` aceita `Uint8Array`, expõe `length`, `getPage`, `destroy()` e
  `format: "png" | "jpg" | "jpeg"`; exige Node **>=22.13** e depende de `pdfjs-dist ~6.4.299`
  (com `@napi-rs/canvas` opcional). `pdfjs-dist` atual é 6.4.299.
- `@ai-sdk/fireworks` atual é **3.0.81** (o plano citava 3.0.80) e depende de
  `@ai-sdk/provider 4.0.34` / `@ai-sdk/provider-utils 5.0.68`.

### Ajustes obrigatórios no plano original

1. **Pipeline é assíncrono (AI-01).** `/api/ai/analyze` responde **202** e o processamento roda
   no worker (`lib/documents/ai-worker.ts`, `after()` ou `/api/ai/jobs/run`). Não existe mais
   caminho para mapear `PdfConversionError` em HTTP **422** na rota. A conversão falha dentro do
   job: `ai_jobs.status = 'failed'`, `error_message` com a mensagem acionável, e o dropzone
   mostra o erro no polling. O worker recomenda usar a mensagem de `PdfConversionError` como
   `error_message`.
2. **IDs de modelo.** O provider `@ai-sdk/fireworks` usa o ID completo
   (`fireworks("accounts/fireworks/models/...")`). Os aliases `deepseek-flash-latest` /
   `glm-flash-latest` são **routers** do Fireworks e precisam do caminho completo:
   `accounts/fireworks/routers/deepseek-flash-latest` e
   `accounts/fireworks/routers/glm-flash-latest`. Confirmar na conta antes do deploy (aliases
   mudam).
3. **Override do `@ai-sdk/provider`.** A raiz fixa `4.0.27`, mas `ai@7.0.153` e
   `@ai-sdk/fireworks@3.0.81` pedem **4.0.34**. Subir o override para `4.0.34` (ou remover) e
   rodar a suíte/build; não deixar Fireworks em 4.0.27 sem teste.
4. **`turbo.json`.** O plano original não incluía as novas envs no `globalEnv`. Adicionar
   `AI_PROVIDER`, `FIREWORKS_API_KEY` e `FIREWORKS_MODEL` (senão `turbo run` pode não repassá-las).
5. **Tracing do deploy.** O pipeline pode rodar em `/api/ai/analyze` (via `after()`) **e** em
   `/api/ai/jobs/run`. `outputFileTracingIncludes` precisa cobrir as duas rotas (e o worker), não
   só `/api/ai/analyze`.
6. **Validação de modelo pelo catálogo.** O form atual permite modelo custom (`__custom__`).
   Restringir ao catálogo quebra modelos novos; decidir: (a) validar apenas o par
   provider/modelo do catálogo, ou (b) aceitar modelo livre quando começar com o prefixo do
   provider (`accounts/fireworks/...`). Recomendado (b) para não travar aliases novos.
7. **Múltiplas imagens.** O Fireworks aceita várias imagens no chat (até 30 por request segundo
   a documentação multimodal); a nota de “uma imagem por request” do AI SDK é da geração/edição
   de imagens (FLUX), não do chat. Manter as páginas no mesmo `FilePart[]`, mas validar no smoke
   com PDF de 2+ páginas.
8. **Testes.** `provider.test.ts` é atualização (não novo); o teste de 422 na rota sai. Cobrir a
   falha de conversão no job (pipeline/worker falhando com `PdfConversionError`).

## 1. Decisões confirmadas

- Provedor padrão: **Fireworks**.
- Modelo padrão: **`accounts/fireworks/routers/deepseek-flash-latest`** (alias do Fireworks; não
  usar `~deepseek/deepseek-flash-latest`, que é slug do OpenRouter). **Revisão:** o ID curto
  `deepseek-flash-latest` não é aceito pelo provider; usar o caminho completo.
- Segundo modelo Fireworks: **`accounts/fireworks/routers/glm-flash-latest`**.
- **OpenRouter permanece** como última opção do seletor, com os modelos atuais:
  - `~openai/gpt-luna-latest` (GPT Luna Latest)
  - `meta/muse-spark-1.3` (Muse Spark 1.3)
- PDFs no Fireworks: **converter páginas em imagens no servidor** (`pdf-to-img`, JPEG) e enviar
  ao modelo. O Fireworks não aceita PDF direto.
- A config global em `app_settings` será **forçada** para `fireworks` + o modelo padrão por
  migration.

## 2. Estado atual relevante

- `apps/web/src/lib/ai/provider.ts` só aceita `openrouter`; `getAiProvider` ignora overrides.
- `apps/web/src/lib/ai/catalog.ts` tem apenas OpenRouter.
- `apps/web/src/lib/settings/ai-settings.ts` valida `z.enum(["openrouter"])` e só reporta
  `openrouterConfigured`.
- `apps/web/src/components/configuracoes/ai-settings-form.tsx` envia `provider: "openrouter"` fixo.
- Tasks (`classify`, `extract-invoice`, `extract-packing-list`, `extract-bl`) montam o PDF como
  `FilePart` e usam plugins do OpenRouter (`file-parser`, `response-healing`).
- `app_settings` hoje: `provider = openrouter`, `model = ~openai/gpt-luna-latest`.
- Constraint do banco: `provider in ('openrouter')`.
- **Revisão:** o pipeline roda no worker (`ai_jobs`), com `runAnalyzePipeline` chamado por
  `ai-worker.ts`; `getAiOverrides()` é lido dentro do pipeline.

## 3. Arquitetura alvo

1. O worker lê a config global (`getAiOverrides`) ao rodar o pipeline.
2. O pipeline prepara o documento **uma única vez**:
   - **Fireworks + PDF** → renderiza páginas em JPEG e monta `FilePart[]` de imagem.
   - **OpenRouter + PDF** → mantém um `FilePart` `application/pdf` (file-parser + fallback mistral-ocr).
   - **Imagem (PNG/JPG/WEBP)** → mantém `FilePart` com o media type original.
3. As tasks recebem `PreparedDocument` e reutilizam o mesmo conteúdo nas 4 chamadas
   (classify, invoice, packing list, BL).
4. `getDocumentLanguageModel` escolhe o client:
   - Fireworks: `createFireworksClient()(modelId)`.
   - OpenRouter: client atual com reasoning/plugins.
5. Logs e `extraction_results` continuam iguais; custo no Fireworks fica `null` (a API não
   devolve custo).

## 4. Alterações por arquivo

### 4.1 Dependências e runtime

- `apps/web/package.json`
  - Adicionar `@ai-sdk/fireworks` (`^3.0.81`, compatível com `ai@7`).
  - Adicionar `pdf-to-img` (`^7.0.1`) e `pdfjs-dist` (`~6.4.299`) como dependência direta
    (garante o tracing dos assets `standard_fonts`/`cmaps` e do `@napi-rs/canvas` opcional).
- `package.json` (raiz)
  - Subir `engines.node` de `>=22.12` para `>=22.13` (exigência do `pdf-to-img`).
  - **Revisão:** atualizar o override `@ai-sdk/provider` de `4.0.27` para `4.0.34` (versão
    exigida por `ai@7.0.153` e `@ai-sdk/fireworks@3.0.81`).
- `pnpm install` para atualizar o lockfile.

### 4.2 Provider e configuração

- **Novo** `apps/web/src/lib/ai/providers/fireworks-config.ts`
  - `DEFAULT_FIREWORKS_MODEL = "accounts/fireworks/routers/deepseek-flash-latest"`.
  - `FireworksConfigError extends AiConfigError` (importando de `@/lib/ai/config`) com mensagem
    sobre `FIREWORKS_API_KEY`.
  - `getFireworksApiKey()` lê `process.env.FIREWORKS_API_KEY`.
  - `getFireworksModel()` lê `FIREWORKS_MODEL` ou usa o default.
- **Novo** `apps/web/src/lib/ai/providers/fireworks.ts`
  - `createFireworksClient()` usando `createFireworks({ apiKey })`.
- `apps/web/src/lib/ai/provider.ts`
  - `AiProviderId = "fireworks" | "openrouter"`.
  - `normalizeOverrides` aceita os dois providers; descarta valores desconhecidos (legado
    `opencode`/inválidos).
  - `getAiProvider`: override → `AI_PROVIDER` (`openrouter` ou `fireworks`) → **`fireworks`**.
  - `getAiModelId`: override → `FIREWORKS_MODEL`/`OPENROUTER_MODEL` conforme o provider.
  - `getDefaultLanguageModel`: branch Fireworks/OpenRouter.
- `apps/web/src/lib/ai/index.ts`
  - Exportar `PdfConversionError` (útil para o worker/log) e manter os exports atuais.
  - Evitar exports sem uso (knip).

### 4.3 Catálogo

- `apps/web/src/lib/ai/catalog.ts`
  - Primeiro item: Fireworks
    - `accounts/fireworks/routers/deepseek-flash-latest` — label “DeepSeek Flash Latest”,
      hint “Padrão do servidor · multimodal”.
    - `accounts/fireworks/routers/glm-flash-latest` — label “GLM Flash Latest”,
      hint “Multimodal · thinking nativo”.
  - Último item: OpenRouter com os dois modelos atuais.
  - Descrições deixam claro: Fireworks converte PDF em imagens; OpenRouter usa file-parser/OCR.

### 4.4 Settings, API e UI

- `apps/web/src/lib/settings/ai-settings.ts`
  - `aiOverridesSchema`: `provider: z.enum(["fireworks", "openrouter"])`.
  - Validação adicional do par provider/modelo (ver §0.6).
  - Mensagem de erro: “Provedor inválido (use fireworks ou openrouter)”.
  - `getServerKeysStatus()`: `{ fireworksConfigured, openrouterConfigured }`.
- `apps/web/src/app/api/settings/ai/route.ts`
  - Tipo do provider para a nova união; erros de modelo/provider inválido como 400.
- `apps/web/src/components/configuracoes/ai-settings-form.tsx`
  - Select de **Provedor** (Fireworks primeiro, OpenRouter por último).
  - Select de modelo filtrado pelo provedor; ao trocar, selecionar o primeiro modelo do novo
    catálogo.
  - Badge de chave configurada conforme o provedor selecionado.
  - Aviso dinâmico quando a chave do provedor não está no servidor.
  - `PUT` envia `{ provider, model }`.
  - Mostrar “Efetivo agora: <provider> · <model>”.

### 4.5 PDF → imagens (Fireworks)

- **Novo** `apps/web/src/lib/ai/pdf-pages.ts`
  - `renderPdfPages(bytes: Uint8Array): Promise<FilePart[]>` usando
    `pdf(bytes, { scale: 2, format: "jpg" })`.
  - Limites iniciais:
    - máximo **30 páginas** por análise;
    - máximo **~7 MB** de imagens cruas (base64 fica abaixo do limite de 10 MB do Fireworks);
    - escala 2.0 (~144 DPI) e JPEG.
  - Sempre `doc.destroy()` em `finally`.
  - PDF protegido/corrompido, página vazia ou excesso de tamanho → `PdfConversionError` com
    mensagem acionável (“selecione OpenRouter ou envie PNG/JPG”).
- `apps/web/next.config.ts`
  - `serverExternalPackages: ["pdf-to-img", "pdfjs-dist", "@napi-rs/canvas"]`.
  - `outputFileTracingIncludes` para **`/api/ai/analyze` e `/api/ai/jobs/run`** incluindo
    `standard_fonts/**` e `cmaps/**` do `pdfjs-dist` (resolver o caminho real via
    `require.resolve` ou incluir `pdfjs-dist` como dependência direta).
  - Validar no `next build` e em um preview da Vercel; se o tracing falhar, o fallback é rotear
    PDFs para o OpenRouter.

### 4.6 Pipeline e tasks

- **Novo** `apps/web/src/lib/ai/document-content.ts`
  - Mover `AnalyzeFileInput` para cá (ou para `tasks/types.ts`) e reexportar onde necessário.
  - `PreparedDocument = { provider, modelId, isPdf, filename, content: FilePart[] }`.
  - `prepareDocument(file, overrides)`:
    - Fireworks + PDF → `renderPdfPages`.
    - OpenRouter + PDF → `FilePart` `application/pdf`.
    - Imagem → `FilePart` com media type original.
- `apps/web/src/lib/ai/tasks/document-model.ts`
  - Aceitar `provider`, `modelId` e `isPdf`.
  - Fireworks → `createFireworksClient()(modelId)`; sem plugins/reasoning do OpenRouter.
  - OpenRouter → manter `file-parser`/`mistral-ocr`, `response-healing` e reasoning.
  - `shouldFallbackPdfEngine` continua só para OpenRouter.
- `apps/web/src/lib/ai/tasks/classify.ts` e `extract-*.ts`
  - Assinatura passa a receber `PreparedDocument`.
  - Trocar o `FilePart` inline por `...prepared.content`.
  - Usar `prepared.provider` no fallback e `prepared.modelId` no retorno/log.
- `apps/web/src/lib/documents/analyze-pipeline.ts`
  - Dentro do `try` do classify: `prepared = await prepareDocument(fileInput, overrides)` e
    depois `classifyDocument(prepared, overrides)`.
  - Reutilizar `prepared` em `extractInvoice`, `extractPackingList` e `extractBl`.
  - Falha na preparação/conversão entra no log de `classify` como erro e é propagada.
- **Revisão (AI-01):** o pipeline roda no worker; `PdfConversionError` propaga até
  `ai-worker.ts`, que marca `ai_jobs.status = 'failed'` e grava `error_message`. **Não** mapear
  422 na rota `/api/ai/analyze` (ela já respondeu 202). O dropzone mostra a mensagem no polling.

### 4.7 Migration

- **Novo** `supabase/migrations/2026MMDDHHMMSS_ai_fireworks_default.sql` (timestamp real na
  criação; a última migration é `20261026124023_ai_jobs`):

```sql
alter table public.app_settings
  drop constraint if exists app_settings_provider_check;

alter table public.app_settings
  add constraint app_settings_provider_check
  check (provider in ('fireworks', 'openrouter'));

insert into public.app_settings (key, provider, model)
values ('ai', 'fireworks', 'accounts/fireworks/routers/deepseek-flash-latest')
on conflict (key) do update
  set provider = excluded.provider,
      model = excluded.model,
      updated_by = null;
```

- Aplicar com Supabase CLI **2.34.3** (`supabase db push`), não com 2.110+.
- Rollback: `update app_settings set provider='openrouter', model='~openai/gpt-luna-latest'
  where key='ai';` (a constraint já aceita OpenRouter).
- `database.types.ts` não muda (o check não aparece nos tipos gerados).

### 4.8 Variáveis de ambiente

`.env.example`:

```env
# --- Provedor de IA (servidor) ---
# fireworks (default) | openrouter
AI_PROVIDER=fireworks

# --- Fireworks (servidor, provedor padrão) ---
# Chave em: https://app.fireworks.ai/settings/api-keys
# PDF não é aceito pela API; o servidor converte as páginas em imagens.
FIREWORKS_API_KEY=
FIREWORKS_MODEL=accounts/fireworks/routers/deepseek-flash-latest

# --- OpenRouter (servidor, opção alternativa) ---
OPENROUTER_API_KEY=
OPENROUTER_MODEL=~openai/gpt-luna-latest
```

- **Revisão:** adicionar `AI_PROVIDER`, `FIREWORKS_API_KEY` e `FIREWORKS_MODEL` em
  `turbo.json` → `globalEnv`; atualizar a tabela de envs do `README.md`.
- Configurar `FIREWORKS_API_KEY` no `.env` local (gitignored) e na Vercel **antes** de ativar a
  migration.
- Manter `OPENROUTER_API_KEY` para quem selecionar OpenRouter.
- Nunca expor chaves em `NEXT_PUBLIC_*`.

### 4.9 Documentação

- `AGENTS.md`: seção “Provedor de IA” → Fireworks (padrão) + OpenRouter (opção), modelos, envs,
  PDF via imagens, health e status do produto.
- `README.md`: tabela de stack, tabela de envs e smoke check.
- `PLAN.md`: atualizar “Infra OpenRouter”, diagrama e o plano linkado.

### 4.10 Testes

- Atualizar `apps/web/src/app/api/ai/health/route.test.ts`
  - Default `provider = fireworks`; adicionar caso OpenRouter.
- Atualizar `apps/web/src/lib/ai/provider.test.ts` (**já existe**, não é novo):
  - Default Fireworks, `AI_PROVIDER=openrouter`, override vence, modelo por provider,
    `normalizeOverrides`.
- **Novo** `apps/web/src/lib/settings/ai-settings.test.ts`
  - Rejeita modelo de outro provider; aceita pares válidos; status das duas chaves.
- **Novo** `apps/web/src/lib/ai/pdf-pages.test.ts`
  - Mock de `pdf-to-img`: nº de páginas, media type, `destroy()`, limite de páginas/tamanho,
    erro envolvido em `PdfConversionError`.
- **Novo** `apps/web/src/lib/ai/document-content.test.ts`
  - Fireworks + PDF → imagens; OpenRouter + PDF → file part; imagem → file part.
- Atualizar `apps/web/src/lib/documents/analyze-pipeline.test.ts`
  - Mockar `prepareDocument` e garantir que é chamado uma vez; tasks recebem o prepared.
- **Revisão:** remover o teste de 422 em `route.test.ts`; cobrir a falha de conversão no
  pipeline/worker (job `failed` com a mensagem).
- Rodar: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm dlx knip` (0 issues).

## 5. Ordem de execução

1. Adicionar dependências, alinhar o override do provider e rodar `pnpm install`.
2. Implementar provider/catálogo/settings/UI.
3. Implementar conversão de PDF e refatorar pipeline/tasks.
4. Atualizar testes e docs.
5. Rodar lint/typecheck/test/build/knip.
6. Configurar `FIREWORKS_API_KEY` + `AI_PROVIDER` + `FIREWORKS_MODEL` no `.env` e na Vercel.
7. Deploy do código.
8. Aplicar a migration (`supabase db push`).
9. Smoke autenticado:
   - `GET /api/ai/health` → `{ ok: true, provider: "fireworks", model:
     "accounts/fireworks/routers/deepseek-flash-latest" }`.
   - `POST /api/ai/analyze` com PDF real → 202, job `succeeded` e extração persistida
     (acompanhar `GET /api/ai/jobs/:id`).
   - Trocar para GLM Flash em `/configuracoes` e repetir o health.
   - Trocar para OpenRouter e testar PDF (file-parser/OCR).
10. Commit único (código + migration + docs).

## 6. Critérios de aceite

- `/configuracoes` mostra Fireworks primeiro (DeepSeek padrão, GLM alternativa) e OpenRouter por
  último.
- Config efetiva global após migration: `fireworks` + router DeepSeek.
- `/api/ai/health` retorna 200 com provider/modelo corretos; 503 quando a chave do provider
  selecionado falta.
- Análise de PDF funciona com Fireworks (páginas convertidas) e com OpenRouter (file-parser);
  falha de conversão aparece no status do job com mensagem acionável.
- Nenhuma chave de API no client.
- Banco aceita `fireworks` e `openrouter`; linha `ai` atualizada.
- `lint`, `typecheck`, `test`, `build` e `knip` verdes.

## 7. Riscos e mitigação

- **IDs de modelo/aliases:** confirmar os routers na conta Fireworks antes do deploy
  (`accounts/fireworks/routers/...`); `FIREWORKS_MODEL` permite trocar sem deploy.
- **Native deps no deploy (`@napi-rs/canvas`/pdfjs):** `serverExternalPackages` + tracing nas
  duas rotas que rodam o pipeline; validar em preview da Vercel.
- **PDF grande/escaneado:** limites de 30 páginas e ~7 MB; erro claro sugerindo OpenRouter ou
  imagens. Ajustar após smoke real.
- **Latência/memória:** converter uma vez por análise e reutilizar nas 4 tasks; o job roda no
  `after()`/worker com `maxDuration` de 120s — PDFs muito grandes podem estourar; reduzir o cap
  se necessário.
- **Structured output no Fireworks:** validar `Output.object` nos dois modelos; se falhar,
  avaliar retry/JSON mode ou manter OpenRouter para essas tasks (fora do escopo inicial).
- **Override do provider:** `4.0.27` vs `4.0.34`; alinhar e testar (ver §0.3).
- **Custo:** Fireworks não devolve custo; `ai_logs.cost_usd` fica `null` até existir tabela de
  preços.

## 8. Fora de escopo

- Fallback automático entre providers em caso de erro (além do fallback de PDF do OpenRouter).
- Cálculo de custo por token no Fireworks.
- Overrides por tenant (a config continua global).
- Streaming de análise.
