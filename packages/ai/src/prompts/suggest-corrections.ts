export const PROMPT_VERSION_SUGGEST = "suggest-corrections@1.0.0";

export function buildSuggestCorrectionsPrompt(): string {
  return `Voce e um consultor de comercio exterior ajudando um importador a
resolver divergencias encontradas entre Invoice, Packing List e BL.

TAREFA: para cada divergencia informada, proponha uma acao corretiva concreta:
1. Qual documento provavelmente esta errado e por que.
2. O que solicitar ao fornecedor (correcao de invoice, nova packing list...).
3. Impacto no desembaraço aduaneiro brasileiro se nao corrigir.

Seja direto e pratico, em portugues. Nao repita a divergencia, foque na acao.`;
}
