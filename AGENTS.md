# AGENTS.md

## Instruções para agentes

Confere.ia é um monorepo pnpm + Turborepo (web + Supabase cloud).
Comandos padrão (lint/typecheck/build/dev) estão no `README.md` e no `package.json` raiz — use-os.
Roadmap e estado do produto: `PLAN.md`.
Auditoria de código morto e exports: `pnpm dlx knip` (esperado: 0 issues).

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
  `accounts/fireworks/routers/glm-flash-latest`). A API não aceita PDF: o pipeline converte as
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
| Página `/configuracoes` | Super-admin (`ADMIN_EMAILS`): provedor/modelo de IA global e teste de conexão |
| Página `/produtos` | Placeholder (CRUD pendente) |
| Shell autenticado | Sidebar: Nova análise, Importações, Empresas, NCM, Produtos (+ Configurações para admin) |
| IA (Fireworks + OpenRouter) | Fireworks padrão (`deepseek-flash-latest`, GLM alternativa; PDF→imagens) + OpenRouter opcional; `/api/ai/health` |
| Observabilidade | OTel (`@vercel/otel` no `instrumentation.ts`); spans `ai.analyze`/`ai.job`/`ai.classify`/`ai.extract_*`/`ai.persist_extraction` e métricas por capability |
| Classificação + extração | Fila `ai_jobs` (202 + worker via `after()`/`/api/ai/jobs/run`); Invoice e número da Invoice no PL em `extraction_results`; BL sem número da Invoice |
| Pipeline completo (extração integral de PL, comparação) | Não implementado |
| Testes automatizados | Vitest 5.0.5 — 699 testes em 43 arquivos; CI roda `test:coverage` (gates: `documents` 88%, `ai` 98%) |

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
- **OpenRouter (opção)**: `OPENROUTER_API_KEY` só no servidor; `/api/ai/health` retorna 503 se a
  chave do provider ativo faltar e 401 sem sessão.
- **Fila de análise (`ai_jobs`)**: `POST /api/ai/analyze` grava o arquivo em
  `<tenant>/_jobs/<jobId>/`, cria o job e responde `202`; o processamento continua no
  `after()` da request. `/api/ai/jobs/run` (Bearer `CRON_SECRET`) drena jobs `queued` ou
  `running` travados há 15 min (até 3 tentativas) — aponte o Vercel Cron para ele.
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
