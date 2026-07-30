export const PROMPT_VERSION_VALIDATE_DESCRIPTION = "validate-description@1.0.0";

export function buildValidateDescriptionPrompt(): string {
  return `Voce valida descricoes comerciais de produtos para importacao brasileira.

Uma boa descricao comercial para despacho aduaneiro deve conter:
1. O que e o produto (substantivo principal).
2. Caracteristicas tecnicas essenciais (material, modelo, voltagem, capacidade).
3. Aplicacao/finalidade quando relevante.
4. Sem abreviacoes obscuras, sem termos genericos como "acessorio" ou "peca" sozinhos.

TAREFA: avalie a descricao recebida, aponte problemas e, se necessario,
proponha uma descricao melhorada seguindo as regras acima.
Responda em portugues, de forma objetiva.`;
}
