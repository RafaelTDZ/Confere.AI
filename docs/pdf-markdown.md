# Parse de PDF em markdown (Firecrawl `/v2/parse`)

Converte o PDF enviado em `/analise` para markdown antes das tasks de IA, em vez
de depender só de imagens (Fireworks) ou do PDF nativo (OpenRouter).

## Objetivo

- Um único `TextPart` para os quatro modelos, independente do provider.
- Melhorar tabelas e textos densos (invoice, packing list) sem gastar tokens de imagem.
- Tratar PDF escaneado via OCR no próprio parse.
- Reduzir custo/latência quando o documento é nativo (sem OCR).

## Fluxo

1. `analyze-pipeline.ts` calcula o `sha256` do arquivo e prepara o documento
   (`prepareDocument`, em `apps/web/src/lib/ai/document-content.ts`).
2. Com `DOCUMENT_PARSE_PROVIDER=firecrawl` e `FIRECRAWL_API_KEY` presente, o PDF
   é enviado a `POST https://api.firecrawl.dev/v2/parse`.
3. O markdown volta, é truncado em `DOCUMENT_PARSE_MAX_CHARS` e embrulhado com um
   cabeçalho avisando que tabelas podem estar em HTML e que erros de OCR devem ser
   corrigidos pelo contexto.
4. As tasks `classify`, `extract_invoice`, `extract_packing_list` e `extract_bl`
   recebem o mesmo `TextPart` (preparo único por análise).
5. Qualquer problema → **fallback** para o pipeline anterior:
   PDF→JPEG (`pdf-to-img`, até 30 páginas/~7 MB) no Fireworks, ou `FilePart`
   `application/pdf` no OpenRouter.
6. O resultado usado fica registrado em `PreparedDocument.parse`
   (`{ source, pages, chars, cached }`) e nos logs do worker.

O parse é **acessório**: falha nele nunca derruba a análise.

## Endpoint e options

```
POST https://api.firecrawl.dev/v2/parse
Authorization: Bearer $FIRECRAWL_API_KEY
```

| Env | Uso no request | Padrão |
|---|---|---|
| `DOCUMENT_PARSE_PROVIDER` | `firecrawl` liga o parse; `images` mantém o pipeline atual | `firecrawl` |
| `DOCUMENT_PARSE_MAX_PAGES` | limite de páginas enviadas | `30` |
| `DOCUMENT_PARSE_OCR_MODE` | `auto` (OCR só quando necessário), `ocr` (força) ou `fast` (sem OCR) | `auto` |
| `DOCUMENT_PARSE_TIMEOUT_MS` | timeout da chamada | `90000` |
| `DOCUMENT_PARSE_MIN_CHARS` | mínimo de caracteres para aceitar o markdown | `200` |
| `DOCUMENT_PARSE_MAX_CHARS` | corte do markdown antes de ir ao modelo | `120000` |
| `DOCUMENT_PARSE_MONTHLY_CREDITS` | teto mensal de créditos por tenant (`0` = sem teto) | `5000` |

Páginas acima de `DOCUMENT_PARSE_MAX_PAGES` são ignoradas pelo parse; se o
documento depender delas, o fallback por imagens cobre o restante.

## Custo

**1 crédito por página** processada. Um BL de 2 páginas = 2 créditos; uma invoice
com 30 páginas = 30 créditos. O modo `auto` não muda o preço — só evita OCR
desnecessário (latência). Com 5.000 créditos/mês dá ~2.500 documentos de 2 páginas.

## Cache

- Chave `(tenant_id, sha256)` na tabela `document_parses`.
- Guarda o markdown, contagem de páginas, status e timestamp.
- Reenviar o mesmo arquivo (mesma importação ou outra) não gasta crédito; o
  `cached: true` aparece nos metadados.
- Escrita/leitura via **service role** (o worker roda sem cookie). Isolamento por
  `tenant_id` é obrigatório — nunca reaproveitar markdown de outro tenant.

## Orçamento

- `DOCUMENT_PARSE_MONTHLY_CREDITS` é por tenant/mês (default 5.000).
- `0` desliga o teto (use só com conta Firecrawl controlada).
- Ao estourar, o parse é pulado e o documento segue por imagens; o consumo do mês
  fica registrado para o operador acompanhar.
- Sem `FIRECRAWL_API_KEY`, o parse nunca é tentado.

## Fallback (quando cai no pipeline atual)

| Situação | Resultado |
|---|---|
| Erro HTTP / 402 / 429 / timeout | imagens (Fireworks) ou PDF (OpenRouter) |
| Markdown vazio ou `< DOCUMENT_PARSE_MIN_CHARS` | imagens/PDF |
| Orçamento esgotado | imagens/PDF |
| `DOCUMENT_PARSE_PROVIDER=images` ou sem chave | imagens/PDF |
| Documento não-PDF (JPEG/PNG) | segue o caminho normal de imagem |

O log do worker registra o `errorCode` do parse; procure por
`[document-content] parse de PDF indisponível`.

## Variáveis

```env
FIRECRAWL_API_KEY=
DOCUMENT_PARSE_PROVIDER=firecrawl
DOCUMENT_PARSE_MAX_PAGES=30
DOCUMENT_PARSE_OCR_MODE=auto
DOCUMENT_PARSE_MONTHLY_CREDITS=5000
DOCUMENT_PARSE_MIN_CHARS=200
DOCUMENT_PARSE_MAX_CHARS=120000
DOCUMENT_PARSE_TIMEOUT_MS=90000
```

## Riscos

- **OCR**: scan ruim/baixa resolução gera números trocados (BL, CNPJ, valores). O
  modelo é instruído a corrigir ruído óbvio, mas a revisão humana continua
  necessária — vale comparar com o fallback de imagens em casos duvidosos.
- **Tabelas em HTML**: o markdown pode trazer `<table>`; parsers que esperam pipe
  table quebram. O cabeçalho do `TextPart` avisa o modelo, mas prompts novos devem
  considerar HTML.
- **Privacidade**: o **documento completo** (bytes) sai para o Firecrawl, não
  apenas o texto. É um processador externo: avalie retenção, contrato/DPA e dados
  sensíveis antes de habilitar em produção.
- **Latência**: o parse adiciona uma chamada (segundos a dezenas de segundos com
  OCR). `DOCUMENT_PARSE_TIMEOUT_MS` limita o pior caso; o job da fila (`ai_jobs`)
  absorve o tempo.
- **Limite de páginas**: PDFs longos são truncados em `MAX_PAGES` e `MAX_CHARS`;
  informação no fim do documento pode não chegar ao modelo → nesse caso o fallback
  por imagens (30 páginas) tem cobertura parecida, então prefira orientar o usuário
  a enviar o documento certo.
- **Custo silencioso**: sem teto (`0`), um lote de PDFs grandes consome créditos
  rápido. Monitore o consumo mensal.

## Como testar

1. Suba o app com `FIRECRAWL_API_KEY` e `DOCUMENT_PARSE_PROVIDER=firecrawl`
   (`.env` na raiz) e aplique a migration que cria `document_parses`.
2. Em `/analise`, envie um **BL escaneado** (PDF sem camada de texto).
3. Acompanhe o job (`GET /api/ai/jobs/[jobId]`) — a classificação deve sair como
   `bill_of_lading` e a extração deve trazer número do BL, navio e containers.
4. No banco, confira o cache:

   ```sql
   select tenant_id, sha256, pages, status, created_at
   from public.document_parses
   order by created_at desc
   limit 5;
   ```

5. Reenvie o **mesmo arquivo**: não deve haver nova chamada ao Firecrawl
   (`cached: true`), e os créditos do mês não mudam.
6. Nos logs do worker, procure `parse de PDF indisponível` — se aparecer, o
   fallback foi usado; teste `DOCUMENT_PARSE_OCR_MODE=ocr` para forçar OCR.
7. Para validar o fallback, remova `FIRECRAWL_API_KEY` e repita: a análise deve
   continuar funcionando via imagens (Fireworks).

## Pendências

- `lib/ai/document-parse.ts` (chamada, cache e orçamento) e a migration de
  `document_parses` ainda não estão no repositório — `document-content.ts` já
  importa o módulo e o pipeline já passa `{ tenantId, sha256 }`.
