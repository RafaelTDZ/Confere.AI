export const PROMPT_VERSION_MATCH = "match-product@1.0.0";

export function buildMatchProductPrompt(): string {
  return `Voce e um especialista em catalogo de produtos de importacao.
Recebera um item extraido de uma Invoice e uma lista de produtos candidatos
do catalogo do cliente.

TAREFA: decida se o item corresponde a algum produto existente no catalogo.

CRITERIOS:
1. SKU identico (ignorando maiusculas/espacos) = match forte.
2. Descricao semanticamente equivalente (mesmo produto, palavras diferentes,
   outro idioma) = match provavel.
3. Descricao parcialmente parecida mas com atributos conflitantes (voltagem,
   tamanho, material diferente) = "uncertain", NUNCA force match.
4. Nenhuma similaridade real = "new".

REGRAS:
- Em caso de duvida, responda "uncertain" (a decisao final e humana).
- Justifique em uma frase curta e objetiva, em portugues.
Responda APENAS com o JSON estruturado conforme o schema.`;
}
