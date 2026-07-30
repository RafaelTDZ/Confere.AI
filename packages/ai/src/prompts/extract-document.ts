import type { DocumentType } from "@confere/domain";

const DOC_LABELS: Record<DocumentType, string> = {
  invoice: "Commercial Invoice (fatura comercial)",
  packing_list: "Packing List (lista de empacotamento)",
  bill_of_lading: "Bill of Lading / BL (conhecimento de embarque)",
};

export const PROMPT_VERSION_EXTRACT = "extract-document@1.0.0";

export function buildExtractDocumentPrompt(docType: DocumentType): string {
  return `Voce e um especialista em comercio exterior brasileiro.
Analise o documento anexo, que e uma ${DOC_LABELS[docType]} de um processo de importacao.

TAREFA: extraia TODOS os dados estruturados do documento.

REGRAS:
1. Extraia exatamente o que esta escrito; nao invente valores ausentes (use null).
2. Itens: capture SKU/codigo/referencia, descricao completa, quantidade, unidade,
   peso unitario (kg) e valor unitario quando presentes.
3. Totais: quantidade total, peso liquido total, peso bruto total (sempre em kg)
   e valor total. Converta libras para kg quando necessario (1 lb = 0,453592 kg).
4. Datas em ISO 8601 (YYYY-MM-DD). Moeda em codigo ISO (USD, EUR, BRL).
5. NCM: apenas se estiver explicito no documento (8 digitos).
6. Atributos extras relevantes (marca, modelo, material, numero de serie)
   vao em "attributes".
7. Avalie sua confianca por campo (0..1): campos ilegiveis ou ambiguos
   recebem confianca baixa. Seja honesto na autoavaliacao.

Responda APENAS com o JSON estruturado conforme o schema.`;
}
