# Identidade visual — Confere.ia (proposta)

**Status:** em implementação. Modo escuro implementado (seção 4.9); as demais fases da seção 6 seguem como proposta.
**Data:** 29/10/2026
**Escopo:** diagnóstico da UI atual, conceito de marca, tokens (claro/escuro), regras de componente, movimento e plano em fases.
**Visual de apoio:** [`preview.html`](preview.html) (style tile autocontido, abrir no navegador).

## 0. Como esta análise foi feita

- **Por código.** Li `apps/web/src/app/globals.css`, `tailwind.config.ts`, `components/ui/*`, `components/layout/app-sidebar.tsx`, `app/layout.tsx`, `app/(app)/layout.tsx`, as páginas `/login`, `/analise`, `/importacoes`, `/importacoes/[id]`, `/rastreio`, `/rastreio/[shipmentId]` e os componentes de rota e de upload.
- **Sem screenshots.** O browser não estava conectado à sessão (`browser.disconnected`), então não consegui abrir `localhost:3000`. Tentei uma vez e não repeti. **Antes de aprovar, valide visualmente no app real** (squint test e screenshots das telas acima).
- **Contraste calculado** pela fórmula WCAG 2.x (luminância relativa, `(L1+0,05)/(L2+0,05)`). Para a paleta padrão do Tailwind v4, que usa oklch, convertei os valores para sRGB (com clipping). Reconfira com axe ou Lighthouse no browser antes de fechar.
- **Limitação de fonte:** `layout.tsx` não carrega nenhuma fonte, então a renderização depende do sistema operacional.

---

## 1. Diagnóstico atual

### 1.1 O que funciona (manter)

- **Sem anti-padrões clássicos de "AI slop".** Não há gradiente, emoji nem sombra grande. Sombras são `shadow-sm` e bordas de 1px (`components/ui/card.tsx:11`). Esse é um bom ponto de partida.
- **Ícones coerentes.** Lucide em 16px (`h-4 w-4`) na navegação e nos botões (`app-sidebar.tsx:72`).
- **Números com `tabular-nums`** em datas e métricas (`rastreio/[shipmentId]/page.tsx:280, 313, 321`), o que ajuda a leitura em colunas.
- **Acessibilidade em partes:** `aria-label` em `nav` de paginação (`pagination.tsx:46`), `aria-current` nos filtros de rastreio (`rastreio/page.tsx:243`), `aria-expanded` e `aria-controls` no card recolhível (`collapsible-card.tsx:39-40`), `text-base` no input de login para evitar zoom no iOS (`login-form.tsx:103`).
- **Degradação do mapa:** sem coordenadas, o componente cai para uma linha tracejada com POL → POD em texto (`route-map.tsx:118-148`). É um bom padrão.
- **Hover em linhas de tabela** existe (`importacoes/page.tsx:164`, `rastreio/page.tsx:88`).

### 1.2 O que parece genérico

- **Tokens são o tema padrão do shadcn/ui.** `globals.css:8-24` usa `--primary: 221.2 83.2% 53.3%` (azul "shadcn") e `--foreground: 222.2 84% 4.9%` (slate). Visualmente, é o app que qualquer projeto shadcn teria por padrão. Não há uma cor de marca.
- **Azul usado como cor de tudo.** `text-primary` aparece como eyebrow em quase todas as páginas (`analise/page.tsx:78`, `importacoes/page.tsx:70`, `rastreio/page.tsx:172`, `empresas/page.tsx:58`, `ncm/page.tsx:55`, `configuracoes/page.tsx:52`, `admin/page.tsx:67`, `produtos/page.tsx:13`). Somado a ícones em `text-primary`, notas `bg-primary/5` e chips, a cor de ação perde força.
- **Item ativo da navegação é um bloco azul sólido** (`app-sidebar.tsx:68`, `bg-primary text-primary-foreground`). É o elemento mais saturado de toda tela e compete com a ação principal da página.
- **Estrutura de cards repetida.** Quase tudo é `Card` + `CardHeader` + `CardTitle text-base` + `CardDescription`. Não há ritmo visual diferente entre "dados", "formulário" e "estado".
- **Marca fraca.** A sidebar mostra só o texto "Confere.ia" em `text-lg font-bold` (`app-sidebar.tsx:93`). Não há marca, símbolo nem identidade própria. O login mostra "Confere AI" em `text-2xl` (`login/page.tsx:15`).
- **Três padrões de cabeçalho de página** para o mesmo papel:
  - `analise/page.tsx:77-83`: eyebrow em `text-xs uppercase tracking-wide` com ícone Sparkles.
  - `importacoes/page.tsx:70` e `rastreio/page.tsx:172`: `text-sm font-medium text-primary`, sem caixa alta.
  - `importacoes/[id]/page.tsx:56-61`: só h1, sem eyebrow.
  Não existe componente `PageHeader`, então cada página reimplementa.

### 1.3 Inconsistências

**Tipografia**

- **Nenhuma família carregada.** `layout.tsx:14-15` não usa `next/font`, e o body só recebe `antialiased`. O texto sai em Segoe UI no Windows e em SF no macOS: a aparência muda de máquina para máquina.
- **Tamanho fora da escala:** `text-[11px]` em `route-map.tsx:144`.
- **Botão pequeno em 12px:** `button.tsx:22`, `sm: "h-8 rounded-md px-3 text-xs"`. Labels de ação a 12px são pequenos para uma ferramenta de trabalho.
- **Badges em 12px semibold:** `badge.tsx:6`. Status em 12px, com cor sozinha, pesa pouco.
- **Inglês na UI em português:** `rastreio/[shipmentId]/page.tsx:255` ("Shipment route"), `:304` ("Timeline"), `:352` ("Details"), `:409` ("Shipment milestones") e cabeçalhos `:418-422` ("Date", "Status", "Location", "Event", "Transport/vessel").
- **Títulos com peso inconsistente:** h1 usa `font-bold` (700) em `importacoes/page.tsx:74`, `analise/page.tsx:84` e outras. Os cards usam 600. O plano pede 600 para títulos.

**Espaçamento (escala 4/8)**

A maior parte já é múltipla de 4. Os desvios que existem:

- `badge.tsx:6`: `px-2.5` (10px) e `py-0.5` (2px).
- `card.tsx:25`: `space-y-1.5` (6px). Repete em `collapsible-card.tsx:46` e `importacao-form` e outros.
- `importacoes/page.tsx:182`: `gap-1.5` (6px).
- `analise/page.tsx:144`: `mt-0.5` (2px).
- `analise/page.tsx:72`, `importacoes/page.tsx:63`: notas com `px-3 py-2` e `text-sm`. São corretas, mas usam `bg-primary/5` para sucesso.

O problema maior é **densidade**, não a escala:

- **Células de tabela com `px-6 py-3`** (24px / 12px) em praticamente todas as tabelas: `importacoes/page.tsx:145-196`, `rastreio/page.tsx:89-135`, `empresas/page.tsx:136-187`, `ncm/page.tsx:125-153`, `admin/*`. Resultado: linha de ~44–45px (12 + 20 de line-height + 12 + borda), o que é pouco denso para uma tela de conferência.
- **Largura máxima de 1024px** (`max-w-5xl`) em todas as páginas (`analise/page.tsx:70`, `importacoes/page.tsx:61`, `rastreio/page.tsx:170`). Formulários e tabelas usam o mesmo limite.
- **Tabelas com `min-w` fixo:** `importacoes/page.tsx:142` (760px), `rastreio/page.tsx:345` (980px), `empresas/page.tsx:133` (880px), `rastreio/[shipmentId]/page.tsx:415` (880px). Conta: em 1280px de viewport, o conteúdo sobra `1280 − 240 (sidebar) − 64 (p-8) = 976px`, menos que os 980px da tabela de rastreio. Ela rola horizontalmente num notebook comum.
- **Ritmo entre páginas diferente:** `analise/page.tsx:70` usa `space-y-8`, `importacoes/page.tsx:61` usa `space-y-6`.

**Raios e sombras**

- `--radius: 0.5rem` (`globals.css:25`) gera 4 / 6 / 8px. Esse sistema está bom.
- Mas aparecem também `rounded-xl` (12px) em `upload-dropzone.tsx:176` e `rounded-full` em chips (`upload-dropzone.tsx:260`) e nos ícones de passo (`analise/page.tsx:109`). Não há regra para cada raio.
- Sombras: `shadow` no botão default (`button.tsx:10`), `shadow-sm` no outline (`:14`), `shadow-lg` no drawer mobile (`app-sidebar.tsx:125`). Sem regra, o botão primário tem sombra e o ghost não. Problema pequeno, mas merece uma escala.

**Cores**

- **Status fora dos tokens.** `badge.tsx:15-16` usa `bg-green-600 text-white` e `bg-amber-500 text-white`. `route-map.tsx:97,105` usa `bg-blue-600` e `bg-emerald-600`. `rastreio/[shipmentId]/page.tsx:202` usa `bg-amber-500/10 text-amber-700`. Não existe token de sucesso, aviso ou info.
- **Semântica confusa de aviso.** `badge.tsx:16` põe "warning" em `arrived` ("Chegou ao porto"), `transshipment` e `blocked` (`lib/tracking/shared.ts:94-101`). "Chegou" é progresso; "bloqueado" é problema. Os dois ficam iguais.

**Contraste (WCAG 2.x)**

Cálculo sobre a paleta real. Limite: texto normal 4,5:1; componente de interface e foco 3:1 (1.4.11).

| Par | Onde | Razão | Mínimo | Resultado |
|---|---|---|---|---|
| Branco / verde `success` (`#00a63e`) | `badge.tsx:15`, texto xs semibold | **3,22:1** | 4,5 | **Falha** |
| Branco / âmbar `warning` (`#fe9a00`) | `badge.tsx:16` | **2,13:1** | 4,5 | **Falha grave** |
| `text-destructive` (~`#ef4444`) / card branco | `login-form.tsx:108,160`, `rastreio/[shipmentId]/page.tsx:195`, `upload-dropzone.tsx:283` | **3,76:1** | 4,5 | **Falha** |
| `text-destructive` / `destructive/10` | erro em faixa rosa (`rastreio/[shipmentId]`, `upload-dropzone`) | **3,29:1** | 4,5 | **Falha** |
| Texto de botão destrutivo / fundo destructive | `button.tsx:12` | **3,6:1** | 4,5 | **Falha** |
| Borda do input (`#e2e8f0`) / branco | `input.tsx:11`, botão outline | **1,23:1** | 3,0 | **Falha** (o campo quase não tem contorno) |
| Anel de foco `primary` / branco | `ring-1` em button, input, collapsible | 5,17:1 | 3,0 | Passa na cor, mas o anel tem **1px** de espessura: pouco visível |
| `text-amber-700` / `amber-500/10` (aviso de navio) | `rastreio/[shipmentId]/page.tsx:202` | 4,66:1 | 4,5 | Passa, no limite |
| `text-muted-foreground` / branco | metadados, rótulos | 4,76:1 | 4,5 | Passa, no limite |
| Texto principal / branco | corpo | 20,0:1 | 4,5 | Passa |
| `primary-foreground` / `primary` | botão padrão, nav ativa | 4,94:1 | 4,5 | Passa |

**Dark mode**

- **Não é alcançável pelo usuário.** `.dark` está definido em `globals.css:28-46`, mas nada aplica a classe `dark`: `layout.tsx:14` renderiza `<html lang="pt-BR">`, e não há ThemeProvider nem script. `dark:` aparece uma única vez (`rastreio/[shipmentId]/page.tsx:202`). Na prática, o modo escuro é código morto.
- **Se for ativado, quebra.** `text-destructive` vira `hsl(0 62.8% 30.6%)` (~`#7f1d1d`) sobre o fundo escuro: **2,00:1**, ilegível. O anel de foco no escuro (`224.3 76.3% 48%`) fica em 2,99:1. A borda de input no escuro fica em 1,37:1.
- Passam no escuro: texto principal 19,1:1; `text-muted` 7,8:1; `primary-foreground` 4,85:1; aviso `amber-300` ~12:1.

**Movimento**

- **Nenhum `prefers-reduced-motion`.** Busca no código sem resultado.
- `transition-all` em `upload-dropzone.tsx:176`, `scale-[1.01]` em `:179`, `transition-all duration-500` com `width` em `:247` (barra de progresso, anima layout).
- `group-hover:translate-x-1` na seta do login (`login-form.tsx:119`).
- `animate-spin` em 12 pontos de 10 arquivos (ex.: `tracking-actions.tsx`, `ai-settings-form.tsx`, `upload-dropzone.tsx:187`), sem alternativa para quem reduz movimento.

**Estados faltando ou fracos**

- **Botão sem estado de loading.** Não existe prop. Cada formulário troca o texto na mão (`login-form.tsx:117`, "Verificando..."), e o spinner aparece só em alguns (`tracking-actions`, `importacao-form.tsx:754`, `partes-form`).
- **Botão sem `active`.** Só `hover`.
- **Input sem estado de erro.** Não há `aria-invalid` nem estilo para erro em `input.tsx`.
- **Sem `loading.tsx`, `error.tsx` nem `not-found.tsx`** em `apps/web/src/app` (busca sem resultado). Ao navegar, a página fica em branco até o servidor responder. Erro de rota cai no padrão do Next.
- **Erro cru.** `importacoes/page.tsx:84` e `rastreio/page.tsx:189` renderizam `{error}` (mensagem técnica do `err.message`) direto para o usuário.
- **Sidebar sem `aria-current`** (`app-sidebar.tsx:61-74`): o item ativo é indicado só pela cor.
- **Drawer mobile sem foco preso** (`app-sidebar.tsx:117-148`): sem `role="dialog"`, `aria-modal` nem trap de foco. Esc fecha (`:46-53`), mas o foco pode sair do menu.
- **Empty states existem** (cards com título e botão, por exemplo `importacoes/page.tsx:98-132`), mas são texto puro, sem ícone nem hierarquia visual.

**Produto e conteúdo (afetam a identidade)**

- **Rastreio não está no menu.** `app-sidebar.tsx:21-27` lista Nova análise, Importações, Empresas, NCM e Produtos. **Não há Rastreio**, embora o módulo exista em `/rastreio` e seja central (ver `AGENTS.md`). Só se chega lá pelo botão da importação ou por link direto.
- **"Produtos"** aparece no menu principal como placeholder (`app-sidebar.tsx:26`), sem "Em breve".
- **Card "Timeline" sem timeline.** `rastreio/[shipmentId]/page.tsx:302-348` mostra ETA, ATA e atraso, não uma linha do tempo. A timeline real é a tabela "Shipment milestones" (`:407-474`), em inglês.
- **Explicação "Como funciona" ocupa a coluna direita** na tela de análise (`analise/page.tsx:96-131`). É útil no primeiro uso e vira ruído para quem usa todo dia.
- **Acentuação faltando** em textos de marca e login: `layout.tsx:5-7` ("Gestao de Importacoes com IA", "Analise automatica", "inteligencia artificial"), `login/page.tsx:17` ("Gestao de importacoes com analise documental"), `login-form.tsx:101` (placeholder "voce@empresa.com.br").
- **Nome da marca em três formas:** "Confere AI" (`login/page.tsx:15`), "Confere.ia" (`app-sidebar.tsx:94`, `layout.tsx:5`), "Confere.ia" também no título. Unificar em "Confere.ia".

---

## 2. Conceito de marca

### 2.1 Posicionamento (4 palavras)

**"Conferência precisa, sem ruído."**

Atributos: **precisa**, **calma**, **densa, mas legível**, **auditável**.

### 2.2 Personalidade

Um auditor experiente: sóbrio, objetivo, respeitoso com o tempo do usuário. Fala em números, datas e status concretos. Não celebra, não empolga e não usa linguagem de marketing.

- Ferramenta de trabalho, não vitrine.
- A cor significa algo. Azul é ação. Verde é conferido. Âmbar pede atenção. Vermelho é problema. Cinza é informação neutra.
- Estrutura antes de decoração: se a tela funciona em escala de cinza, está certa.

### 2.3 Metáfora visual

**Papel de conferência.** Superfícies claras e frias, lembrando uma folha de conferência. Linhas finas como margens de planilha. Um único azul para confirmar e agir. Status com sinal (ponto + texto), nunca só cor. Sem carimbo ornamental: se houver carimbo, ele é um status, não um enfeite.

### 2.4 Logo (proposta, a desenhar)

- **Wordmark:** "Confere.ia" em Inter 600, tracking −0,02em.
- **Símbolo:** quadrado de 20px com cantos de 4px, fundo `accent`, um check branco. Lê-se em 16px e em favicon.
- Não há proposta de ilustração. Estados vazios usam ícone Lucide em círculo.

### 2.5 Referências (para inspiração, não para copiar)

- **Stripe Dashboard:** densidade calibrada, tabela e tipografia numérica, neutros frios.
- **Linear:** hierarquia por peso e neutros, modo escuro bem calibrado, pouca cor.
- **Ramp / Mercury:** finanças com status claros, sem excesso de decoração.
- **Flexport:** contexto logístico (rota, timeline, eventos). Referência de domínio para o rastreio.

### 2.6 O que evitar

- Gradientes, glow e glassmorphism.
- Cards com sombra grande, "flutuando".
- Ícones coloridos decorativos e emoji.
- Sparkles como símbolo de IA em todo lugar: a IA é meio, não identidade.
- Azul-padrão do shadcn sem ajuste de marca.
- Cinza morto, sem temperatura, em tudo.
- Verde ou âmbar com texto branco (falha de contraste).
- Cor de status usada como decoração.
- Copy de marketing ("revolucione seu fluxo", "potencialize").

---

## 3. Tokens propostos

Nomes semânticos. A tabela de cores traz o hex, o uso e o contraste calculado.

### 3.1 Cores — tema claro

| Token | Hex | Uso | Contraste |
|---|---|---|---|
| `canvas` | `#F5F6F8` | Fundo da aplicação | texto 16,5:1 |
| `surface` | `#FFFFFF` | Cards, tabela, inputs, drawer | texto 17,9:1 |
| `muted` | `#F1F3F6` | Cabeçalho de tabela, chip inativo, área recuada | text-2 8,1:1; text-muted 5,2:1 |
| `border` | `#E3E7ED` | Divisórias decorativas (não controles) | 1,24:1 (só decorativo) |
| `border-strong` | `#757F90` | Contorno de input, botão outline, checkbox | 4,0:1 sobre branco; 3,6:1 sobre muted |
| `text` | `#0F172A` | Texto principal, títulos | 17,9:1 sobre branco |
| `text-2` | `#3F4A5C` | Texto secundário, descrições | 9,0:1 sobre branco |
| `text-muted` | `#5B6678` | Metadados, rótulos de coluna, placeholders | 5,8:1 sobre branco; 5,2:1 sobre muted |
| `accent` | `#1D4ED8` ("Azul Porto") | Ação primária, link, foco, nav ativa | 6,7:1 com branco; 6,2:1 sobre canvas |
| `accent-hover` | `#1E40AF` | Hover do botão primário | branco 8,7:1 |
| `accent-active` | `#1E3A8A` | Pressed do botão primário | branco > 10:1 |
| `accent-soft` | `#EAF0FD` | Nav ativa, chip selecionado | accent sobre soft 5,9:1 |
| `focus` | `#1D4ED8` | Anel de foco de 2px, offset 2px `surface` | 6,2:1 sobre canvas |
| `success` | `#15803D` | Botão/ponto de sucesso | branco 5,0:1 |
| `success-text` | `#166534` | Texto de sucesso | 6,4:1 sobre `success-soft` |
| `success-soft` | `#E7F6EC` | Fundo de badge/nota de sucesso | — |
| `warning` | `#B45309` | Ponto/ícone de atenção | branco 5,0:1 |
| `warning-text` | `#92400E` | Texto de atenção | 6,4:1 sobre `warning-soft` |
| `warning-soft` | `#FEF3C7` | Fundo de badge/nota de atenção | — |
| `danger` | `#B91C1C` | Erro, destrutivo, borda de erro | branco 6,5:1 |
| `danger-text` | `#B91C1C` | Texto de erro | 5,7:1 sobre `danger-soft` (`#FDECEC`) |
| `danger-soft` | `#FDECEC` | Fundo de erro | — |
| `neutral-soft` | `#EEF1F5` | Badge neutro | text-2 7,9:1 |

Info usa `accent`. Não criar uma quinta cor.

### 3.2 Cores — tema escuro

Fundo não é preto puro. Elevação por superfície mais clara, não por sombra. Cores de marca dessaturadas.

| Token | Hex | Uso | Contraste |
|---|---|---|---|
| `canvas` | `#0A0E14` | Fundo | texto 16,3:1 |
| `surface` | `#11161F` | Cards, tabela, inputs | texto 15,3:1 |
| `muted` | `#171E2A` | Cabeçalho de tabela, menus, popover | texto 14,1:1; text-muted 5,8:1 |
| `border` | `#232C3B` | Divisórias decorativas | só decorativo |
| `border-strong` | `#5A6478` | Contorno de controle | 3,05:1 sobre surface |
| `text` | `#E8ECF2` | Texto principal | 15,3:1 sobre surface |
| `text-2` | `#B4BDCB` | Texto secundário | 9,6:1 sobre surface |
| `text-muted` | `#8E99AB` | Metadados, rótulos | 6,3:1 sobre surface; 5,8:1 sobre muted |
| `accent` | `#8AB0FF` | Link, nav ativa (texto/ícone) | 8,4:1 sobre surface |
| `accent-btn` / `on-accent` | `#7AA2FF` / `#0A0E14` | Botão primário | 7,8:1 |
| `accent-soft` | `#1A2748` | Nav ativa, chip | `accent` sobre soft 6,8:1 |
| `success-text` | `#7DD3A0` | Texto de sucesso | 10,1:1 sobre surface; 8,6:1 sobre `success-soft` (`#12291E`) |
| `warning-text` | `#F5C863` | Texto de atenção | 11,5:1 sobre surface; 10,1:1 sobre `warning-soft` (`#2A2110`) |
| `danger-text` | `#F5A3A3` | Texto de erro | 9,2:1 sobre surface; 8,7:1 sobre `danger-soft` (`#2B1517`) |
| `neutral-soft` | `#1C2431` | Badge neutro | text-2 8,2:1 |

Regra: no escuro, badges usam `*-text` sobre `*-soft` escuro (tint). Nunca `*` sólido com texto branco.

### 3.3 Tipografia

**Família**

- **UI:** Inter, carregada com `next/font/google` (self-host pelo Next; não é dependência npm nova). Fallback: `ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif`.
- **Mono (códigos):** JetBrains Mono ou Geist Mono, também via `next/font`. Usar em BL, container, NCM, número de referência e chave de documento.
- Decisão em aberto: Inter ou Geist (ver seção 8).

**Escala** (px / line-height / peso / tracking)

| Token | Tamanho / LH | Peso | Tracking | Uso |
|---|---|---|---|---|
| `caption` | 12 / 16 | 500 | +0,04em (caixa alta só em rótulos de coluna) | Rótulos de coluna, badges, metadados |
| `ui` | 14 / 20 | 400 / 500 | 0 | Tabela, botão, input, nav, corpo de card (**padrão de UI densa**) |
| `body` | 16 / 24 | 400 | 0 | Texto de ajuda longo, estados vazios, login |
| `h4` (card-title) | 16 / 24 | 600 | 0 | Título de card |
| `h3` (section) | 20 / 28 | 600 | −0,01em | Subseção |
| `h2` (page) | 24 / 32 | 600 | −0,02em | Título de página |
| `display` | 32 / 40 | 600 | −0,02em | Login e raros destaques |

- **Desvio consciente da skill.** A skill pede corpo de 16px no mínimo na web. Para UI densa (tabela, nav, formulário de conferência), proponho `ui` em 14px como padrão, com 16px onde o texto é lido em bloco (estados vazios, login, ajuda). Precisa de aprovação (ver seção 8).
- **Peso:** 400 corpo, 500 UI e rótulos, 600 títulos. Sair do 700 (`font-bold` em `h1`, `text-lg font-bold` na marca).
- **Números:** `font-variant-numeric: tabular-nums` em datas, valores, contagens e colunas. Mono para códigos.
- **Medida:** texto corrido em no máximo 65ch.

### 3.4 Raio

| Token | Valor | Uso |
|---|---|---|
| `radius-sm` | 4px | Badge, tag, kbd |
| `radius-md` | 6px | Botão, input, item de nav, select |
| `radius-lg` | 8px | Card, popover, drawer, mapa |
| `radius-full` | 9999px | Só avatar e ponto de status |

Remover `rounded-xl` (`upload-dropzone.tsx:176`) e chips pill (`upload-dropzone.tsx:260`). Usar `radius-lg` no dropzone e o estilo de badge nos chips.

### 3.5 Sombra e elevação

| Token | Valor | Uso |
|---|---|---|
| `shadow-none` | — | Cards (elevação só por borda) |
| `shadow-xs` | `0 1px 2px rgb(15 23 42 / 0.05)` | Botão primário, cabeçalho sticky |
| `shadow-overlay` | `0 12px 32px -12px rgb(15 23 42 / 0.25)` | Popover, drawer mobile |

No escuro: sem sombra. Elevação por `muted` (superfície mais clara) e borda.

### 3.6 Espaçamento

Escala 4/8: `4, 8, 12, 16, 24, 32, 48, 64`. Tokens semânticos:

- **Padding de card:** 20px horizontal × 16px vertical no cabeçalho compacto; 24px no padrão. Substitui `p-6` fixo.
- **Célula de tabela:** 12px horizontal; 16px na primeira coluna. Altura de linha **40px**, cabeçalho **32px**. Substitui `px-6 py-3` (~44px por linha).
- **Padding de página:** 16px mobile, 24px tablet, 32px desktop. O `md:p-8` atual (`(app)/layout.tsx:20`) fica como 32px desktop.
- **Gap de grupo:** 8px (item), 16px (campos), 24px (seção), 32px entre blocos de página.
- **Alvo de toque:** 44×44px em ações primárias no mobile (`@media (pointer: coarse)`).

### 3.7 Grid e largura

- **Grid de 12 colunas**, gap 24px no desktop e 16px no mobile.
- **Breakpoints:** 640 (sm), 768 (md, sidebar aparece), 1024 (lg), 1280 (xl).
- **Largura máxima por tipo de tela:**
  - Lista e tabela: **1280px** (substitui o `max-w-5xl` de 1024px em todas as páginas).
  - Detalhe (importação, rastreio): **1152px**.
  - Formulário e configuração: **720px**.
- **Sidebar:** 240px fixa desde md. Abaixo, drawer.
- **Tabela:** sem `min-w` fixo. Colunas secundárias ocultas abaixo de `xl` (`hidden xl:table-cell`), com a coluna mais importante sempre visível.

---

## 4. Regras de componente

### 4.1 Botão (`components/ui/button.tsx`)

- **Alturas:** `sm` 32px (padding 12px, 14px/500); `md` 36px (padding 16px) é o padrão; `lg` 40px (padding 20px), só em ação isolada de página (ex.: login). Ação primária em mobile: 44px.
- **Variantes:**
  - `primary`: fundo `accent`, texto branco. Uma por bloco, no máximo.
  - `secondary`: fundo `surface`, borda `border-strong`, texto `text`.
  - `ghost`: texto `text-2`, sem borda. Hover em `muted`.
  - `destructive`: fundo `danger`, texto branco. Só para ação irreversível, com confirmação.
  - `link`: texto `accent`, sublinhado no hover.
- **Estados:**
  - **Default:** repouso.
  - **Hover:** primary vai para `accent-hover` em 120ms; secondary e ghost ganham fundo `muted`. Só com ponteiro (`@media (hover: hover)`).
  - **Focus-visible:** anel de 2px `focus` com offset de 2px `surface`. Substitui o `ring-1` atual (`button.tsx:6`).
  - **Active:** `accent-active` e `scale(0.98)` em 120ms.
  - **Disabled:** opacidade 0,5, `cursor-not-allowed`, sem hover, `aria-disabled`.
  - **Loading:** spinner de 16px à esquerda, o mesmo texto (ex.: "Salvando…"), largura fixa, `aria-busy="true"` e `disabled`. Nada de trocar o texto à mão.
- **Texto:** verbo + objeto. "Enviar documentos", "Salvar consignee". Nunca "OK" ou "Continuar" sozinho.

### 4.2 Card (`components/ui/card.tsx`)

- Fundo `surface`, borda 1px `border`, `radius-lg`, sem sombra no repouso.
- **Cabeçalho:** título `h4` (16/24/600), descrição `ui` em `text-muted`. Separador `border-b` só quando há ações no cabeçalho.
- **Variante `flush`:** para tabela. Corpo sem padding, cabeçalho com `border-b`.
- **Sem cards dentro de cards.** Evitar aninhamento: subseções usam título e divisor, não um card novo.
- Título de card não é h1. Hierarquia de página fica no `PageHeader`.

### 4.3 Badge (`components/ui/badge.tsx`)

- **Anatomia:** altura 20px, padding horizontal 8px, `radius-sm`, texto `caption` (12/16/500). Ponto de 6px com a cor semântica, à esquerda do texto.
- **Variantes:** `neutral`, `accent`, `success`, `warning`, `danger`. Remover `outline` (vira `neutral` com borda).
- **Cor:** texto `*-text` sobre `*-soft`. Nunca texto branco sobre fundo colorido.
- **Mapeamento de status (proposto):**

| Status | Variante | Motivo |
|---|---|---|
| Importação: `uploaded` | neutral | Recebido, sem ação |
| Importação: `processing` | accent | Em andamento |
| Importação: `awaiting_review` | warning | Precisa de ação humana |
| Importação: `completed` | success | Concluído |
| Importação: `rejected`, `failed` | danger | Falha ou rejeição |
| Rastreio: `pending` | neutral | Aguardando |
| Rastreio: `in_transit` | accent | Em trânsito |
| Rastreio: `transshipment` | warning | Atenção: transbordo |
| Rastreio: `arrived` | accent | Progresso (hoje é warning) |
| Rastreio: `discharged`, `delivered` | success | Concluído |
| Rastreio: `empty_returned` | neutral | Encerrado |
| Rastreio: `not_found` | neutral | Sem dado |
| Rastreio: `blocked` | warning | Ação: rastreio bloqueado |
| Rastreio: `error` | danger | Falha |

### 4.4 Input (`components/ui/input.tsx`)

- **Altura:** 36px. Padding 12px. `radius-md`. Texto `ui` (14px) no desktop e 16px no mobile, para não dar zoom no iOS.
- **Borda:** `border-strong` (contraste 4,0:1 sobre branco, passa em 1.4.11). Hoje é `#e2e8f0` (1,23:1).
- **Placeholder:** `text-muted` (5,8:1). Não é rótulo: o campo sempre tem `label` visível.
- **Label:** `ui` 500, acima do campo. Obrigatório marcado no texto ("(opcional)" é mais claro que asterisco).
- **Foco:** borda `accent` e anel de 2px `accent` (3:1+). Substitui `ring-1`.
- **Erro:** borda `danger`, `aria-invalid="true"`, texto de erro abaixo com ícone, `aria-describedby` apontando para a mensagem. Texto em `danger-text` (5,7:1 sobre `danger-soft`).
- **Ajuda:** `caption` em `text-muted` abaixo do campo.
- **Desabilitado:** fundo `muted`, texto `text-muted`, cursor `not-allowed`.

### 4.5 Tabela densa

- **Estrutura:** container `flush`. Cabeçalho 32px, fundo `muted`, rótulo `caption` em `text-muted`, caixa alta só nos rótulos (+0,04em).
- **Linha:** 40px. Célula com 12px horizontal (16px na primeira). Texto `ui`. Separador `border`.
- **Hover:** fundo `muted`. Não muda cor do texto.
- **Alinhamento:** colunas numéricas e de data à direita, `tabular-nums`. Códigos (BL, container, NCM) em mono.
- **Linha clicável:** o link fica na primeira célula. Não usar `after:absolute` para toda a linha (como hoje, `importacoes/page.tsx:170`), porque bloqueia seleção de texto e menus de contexto.
- **Ações:** última coluna, botão `ghost` 32px com ícone e `aria-label`. Sem texto.
- **Ordenação:** `aria-sort` no `th`, indicador de 12px.
- **Cabeçalho sticky** no scroll vertical. Primeira coluna sticky no scroll horizontal (mobile).
- **Rodapé:** "Página 2 de 9 · 25 por página" à direita, paginação com `secondary` sm.
- **Estados:**
  - Loading: 5 linhas de skeleton, 40px cada.
  - Vazio: linha única com ícone, texto e ação.
  - Erro: banner acima da tabela (ver 4.9).

### 4.6 Navegação

**Sidebar (desktop)**

- 240px, fundo `surface`, `border-r`. Cabeçalho de 56px com símbolo (20px) e wordmark "Confere.ia" (16/24/600).
- **Grupos com rótulo `caption`:**
  - **Operação:** Nova análise, Importações, **Rastreio** (faltando hoje), Empresas, NCM.
  - **Administração** (super-admin): Admin, Configurações.
  - **Produtos:** "Em breve" (desabilitado) ou fora do menu até existir.
- **Item:** altura 32px, padding 8px, `radius-md`, texto `ui` 500 em `text-2`, ícone 16px em `text-muted`.
  - Hover: fundo `muted`, texto `text`.
  - **Ativo:** fundo `accent-soft`, texto e ícone em `accent-text`, barra de 2px `accent` à esquerda, `aria-current="page"`. Nunca fundo azul sólido.
- **Rodapé:** avatar com iniciais (24px), e-mail truncado, "Sair" como `ghost` sm.

**Mobile**

- Header de 56px com marca e botão de menu.
- Drawer com `role="dialog"` e `aria-modal="true"`. Foco vai para o botão de fechar ao abrir e volta ao botão de origem ao fechar. Trap de foco. Esc fecha. Fundo com `inert`.

**Página**

- **`PageHeader`** (componente novo, substitui os seis cabeçalhos atuais): eyebrow em `caption` `text-muted` com ícone 16px, título `h2`, descrição `ui` em `text-muted` (máx. 60ch), ações à direita.
- **Breadcrumb** nas telas de detalhe (Importações › BL-123), no lugar do `BackButton` solto.

### 4.7 Timeline e mapa de rota (rastreio)

**Timeline (tela de detalhe)**

- Lista vertical. Cada item tem um ponto de 12px sobre uma linha de 2px `border`.
- **Ponto:**
  - Concluído: `success` sólido, com ícone de check de 10px (não depende só de cor).
  - Atual: `accent` com halo de 4px `accent-soft`.
  - Futuro: contorno `border-strong`, vazio.
- **Texto:** evento em `ui` 500; local e data em `caption` `text-muted`; data com `tabular-nums`.
- Agrupar por dia. Mais recente no topo.
- Substitui a tabela "Shipment milestones" nessa tela. A tabela continua na lista de rastreios.

**Card "Timeline" atual → renomear para "Prazos"** (ETA, ATA e atraso). Hoje o nome não corresponde ao conteúdo (`rastreio/[shipmentId]/page.tsx:302-304`).

**Mapa de rota**

- Origem: anel vazio em `text`. Destino: ponto sólido em `accent`. Linha tracejada em `accent`.
- Rótulos com código UN/LOCODE quando disponível, além do nome.
- Legenda sem cores hardcoded (`route-map.tsx:97,105` usam `blue-600` e `emerald-600`; trocar pelos tokens).
- Fallback textual (linha tracejada) já existe e fica, tokenizado.
- Aviso de transbordo ou rollover (`rastreio/[shipmentId]/page.tsx:202`) vira nota `warning-soft` com ícone, em vez de `amber-500/10` fixo.

### 4.8 Estados vazios, erro e loading

**Vazio**

- Ícone Lucide de 20px em círculo de 40px com fundo `muted`.
- Título `h4`, descrição `body` em `text-muted` (até 48ch), uma ação primária.
- Nunca só texto. Sem ilustração decorativa.

**Erro**

- Banner inline com fundo `danger-soft`, ícone, e três partes: **o que aconteceu**, **o que fazer** e botão "Tentar de novo".
- Mensagem técnica fica em "Detalhes" (collapsible), não no corpo principal.
- Nunca renderizar `err.message` cru (`importacoes/page.tsx:84`, `rastreio/page.tsx:189`).
- Erro de formulário segue a regra do input (4.4).

**Loading**

- `loading.tsx` por segmento (`(app)/…`) com skeleton do mesmo layout da página, com a mesma altura de cabeçalho e linhas. Sem layout shift.
- Botões: spinner e texto mantido (4.1).
- Progresso de upload: barra com `transform: scaleX` em vez de animar `width`.
- Spinner para reduced motion: troca rotação por pulso de opacidade (ver seção 5).

**Notas (aviso, sucesso, info)**

- Mesmo padrão: fundo `*-soft`, ícone, texto em `*-text`, `radius-md`, padding 12px 16px.
- Sucesso ("Consignee e notify cadastrados", `analise/page.tsx:72`) passa a usar `success-soft`, não `primary/5`.

### 4.9 Modo escuro

**Status:** implementado (fase 5).

- **Ativação:** classe `dark` no `<html>` (o `@custom-variant dark` de `globals.css` usa essa classe) e `color-scheme` no mesmo elemento. Um script inline no `<head>` (`THEME_INIT_SCRIPT`, em `components/theme/theme-shared.ts`) aplica a classe antes do primeiro paint, então não há flash. Padrão: `system`.
- **Preferência:** `localStorage` na chave `confere-theme` (`light` | `dark` | `system`). Valor inválido ou storage bloqueado cai em `system`. `ThemeProvider` em `components/theme/theme-provider.tsx`; sem dependências novas.
- **Como trocar:** botão 36×36 com ícone (Sol, Lua, Monitor) no rodapé da sidebar, ao lado do e-mail, e no canto superior direito do login. Cicla claro → escuro → sistema → claro. `aria-label` e `title` dizem o tema atual e o próximo.
- **Regras:** tokens da seção 3.2. Sem preto puro e sem branco puro. Cores de marca dessaturadas. Badges com tint escuro. Sem sombra.
- **Correções feitas:** erro em texto usa `text-destructive-text` (antes `text-destructive`, ~2,0:1 no escuro). O mapa Leaflet usa tokens (classes, não hex) e os tiles são invertidos no escuro. A paleta não mudou.

---

## 5. Movimento

### 5.1 Durações e curvas

| Token | Valor | Uso |
|---|---|---|
| `duration-fast` | 120ms | Hover, press, cor de texto e fundo |
| `duration-base` | 180ms | Estados, chevron do collapsible, troca de aba |
| `duration-slow` | 240ms | Drawer, overlay, barra de progresso |
| `ease-out` | `cubic-bezier(0.2, 0, 0, 1)` | Entradas e mudanças de estado |
| `ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Saídas (fechar drawer) |

- Animar só `transform` e `opacity`. Evitar `width`, `height` e `top/left`.
- Remover `transition-all` (`upload-dropzone.tsx:176`). Listar as propriedades.
- Remover `scale-[1.01]` do dropzone (`:179`). Trocar por mudança de borda e fundo.
- Seta do login: `translate-x-1` só no hover e apenas com ponteiro (`login-form.tsx:119`).

### 5.2 `prefers-reduced-motion`

Não existe hoje. Adicionar em `globals.css`:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
  .animate-spin { animation: pulse-opacity 1.6s ease-in-out infinite; }
}
```

- O spinner não some: vira pulso de opacidade. Ele sinaliza carregamento, então continua existindo.
- Nada de parallax, auto-play nem movimento em loop decorativo.

---

## 6. Plano de aplicação em fases

Impacto e esforço são estimativas de análise de código; validar no browser.

| Fase | O que muda | Impacto | Esforço | Dependência |
|---|---|---|---|---|
| **0. Correções de contraste e erro** | Badges `success` e `warning`; `text-destructive`; borda de input; anel de foco para 2px; remover `err.message` cru; `aria-current` e foco no drawer; "Confere AI" → "Confere.ia"; acentos em login e metadata; headers em inglês → pt-BR; **Rastreio no menu** | Alto | Baixo | Nenhuma (só aprovação de cores de status) |
| **1. Tokens** | Reescrever `globals.css` com tokens semânticos (cores, status, raio, sombra, motion); mapear os nomes shadcn atuais para os novos valores para não mexer em ~80 arquivos de uma vez; `next/font` (Inter + mono); `prefers-reduced-motion`; remover `text-[11px]` | Alto | Médio | Decisões da seção 8 (cor, fonte) |
| **2. Componentes base** | Button (loading, active, focus 2px, sm 14px); Badge (ponto + tint, 20px); Input (erro, `aria-invalid`); Card (padding, flush); tabela densa (40px, cabeçalho 32px); componente `PageHeader` | Alto | Médio | Fase 1 |
| **3. Navegação e layout** | Sidebar em grupos, item ativo em `accent-soft`, símbolo de marca, drawer com foco preso; larguras por tipo de tela; `loading.tsx`, `error.tsx`, `not-found.tsx` com skeleton | Alto | Médio | Fase 2 |
| **4. Domínio** | Timeline no detalhe do rastreio; mapa tokenizado; "Timeline" → "Prazos"; "Como funciona" colapsável após o primeiro uso; dropzone com estados revisados; notas de sucesso/aviso | Médio | Médio | Fase 2 |
| **5. Modo escuro** | Feito: classe `dark` com script no `<head>`, toggle na sidebar e no login, correções de texto de erro e mapa. Falta QA visual de contraste em todas as telas | Médio | Médio | Fases 1 e 2 |
| **6. Polimento** | Empty states com ícone, revisão de copy (pt-BR com acentos), breadcrumbs, skeletons finos | Baixo | Baixo | Todas |

**Ordem recomendada:** 0 → 1 → 2 → 3. A fase 0 não depende de decisão de marca (só de correção) e já elimina as falhas de WCAG. As fases 4 a 6 podem ser paralelas.

---

## 7. Checklist da skill (`design-de-interfaces`)

| Item | Resposta | Evidência |
|---|---|---|
| Uma ação primária clara por tela? | **Parcial.** Análise e importação têm uma ação clara. Na sidebar, o bloco azul ativo compete com ela. | `app-sidebar.tsx:68` |
| Espaçamento múltiplo de 4/8? | **Quase.** Maior parte é múltipla de 4. Desvios: 6px, 10px, 2px. Densidade de tabela é o problema real. | `badge.tsx:6`, `card.tsx:25`, `importacoes/page.tsx:145` |
| Contraste ≥ 4,5:1 (corpo) e 3:1 (grande)? | **Não.** Badges success e warning, erro em texto, borda de input. | Seção 1.3 |
| Hover, focus, active, disabled, loading, empty, error? | **Parcial.** Hover e disabled ok. Active ausente. Loading inconsistente. Focus de 1px. Erro com mensagem técnica. | `button.tsx:6`, `importacoes/page.tsx:84` |
| Focus-visible com anel claro? | **Não.** `ring-1` (1px). | `button.tsx:6`, `input.tsx:11` |
| Mobile, tablet e desktop sem quebrar? | **Não verificado no browser.** Pelo código: tabelas com `min-w` fixo rolam; drawer mobile sem foco preso. | `importacoes/page.tsx:142`, `app-sidebar.tsx:117` |
| `prefers-reduced-motion` respeitado? | **Não.** Não existe. | Busca sem resultado |
| Algum anti-padrão de "AI slop"? | **Não no sentido clássico.** Há o problema de genérico: tema shadcn padrão, Sparkles como identidade, copy neutra. | Seção 1.2 |
| Funciona em escala de cinza? | **Parcial.** A estrutura (bordas, cabeçalhos, hierarquia) funciona; a nav ativa azul sólida domina. Confirmar com squint test no browser. | `app-sidebar.tsx:68` |

---

## 8. O que precisa de aprovação antes de implementar

1. **Cor de marca.** "Azul Porto" `#1D4ED8` (proposta) ou outra direção (ex.: tinta escura com acento teal `#0F766E`). Se trocar, refazer os contrastes.
2. **Fonte.** Inter (proposta, base neutra e legível para tabelas) ou Geist.
3. **Tamanho de texto de UI.** 14px como padrão de UI densa, desviando da regra de 16px da skill. Aprovar o desvio.
4. **Modo escuro.** Ativar (toggle + padrão do sistema) ou manter desligado até a fase 5.
5. **Rastreio no menu lateral.** Confirmar que é item de primeiro nível (decisão de produto).
6. **"Produtos" no menu.** Ocultar ou marcar "Em breve".
7. **Nome da marca.** "Confere.ia" em todos os textos. Símbolo a desenhar.
8. **Cores de status (fase 0).** Aceitar a nova semântica: `arrived` deixa de ser aviso; `awaiting_review` vira aviso; `blocked` continua aviso.
9. **Validação visual.** Screenshots reais das telas (`/login`, `/analise`, `/importacoes`, `/importacoes/[id]`, `/rastreio`, `/rastreio/[shipmentId]`) e teste de contraste com axe/Lighthouse. Este documento foi feito por código.

---

## Apêndice: método de cálculo

- **Contraste:** luminância relativa WCAG 2.x. `L = 0,2126·R + 0,7152·G + 0,0722·B` com linearização sRGB. Razão `(L_maior + 0,05) / (L_menor + 0,05)`.
- **HSL → RGB:** tokens de `globals.css` convertidos pela fórmula padrão de HSL.
- **Paleta Tailwind v4 (oklch):** `green-600` = oklch(62.7% 0.194 149.2) ≈ `#00a63e`; `amber-500` = oklch(76.9% 0.188 70.1) ≈ `#fe9a00`; `amber-700` ≈ `#bb4d00`; `amber-300` ≈ `#ffd230`. Convertidos para sRGB com clipping.
- **Mínimos:** texto normal 4,5:1; texto grande (≥18,66px bold ou ≥24px) 3:1; componente de interface e indicador de foco 3:1 (WCAG 1.4.11).
