import type {
  BlExtraction,
  DocumentType,
  InvoiceExtraction,
} from "@/lib/ai/schemas";

export type ImportStatus =
  | "uploaded"
  | "processing"
  | "awaiting_review"
  | "completed"
  | "rejected";

export type ImportRow = {
  id: string;
  reference_number: string | null;
  status: string;
  supplier_name: string | null;
  invoice_number: string | null;
  bl_number: string | null;
  created_at: string;
};

export const IMPORT_DOCUMENT_TYPES: DocumentType[] = [
  "invoice",
  "packing_list",
  "bill_of_lading",
];

export type ImportPartySummary = {
  id: string;
  name: string;
};

export type ImportDocumentRow = {
  id: string;
  doc_type: DocumentType;
  original_filename: string | null;
  status: string;
  version: number;
  created_at: string;
};

export type ImportDetail = ImportRow & {
  updated_at: string;
  consignee: ImportPartySummary | null;
  notify: ImportPartySummary | null;
  documents: ImportDocumentRow[];
  invoice: InvoiceExtraction | null;
  bl: BlExtraction | null;
};

export const IMPORT_STATUS_LABELS: Record<
  string,
  {
    label: string;
    variant:
      | "default"
      | "secondary"
      | "destructive"
      | "success"
      | "warning"
      | "outline";
  }
> = {
  uploaded: { label: "Enviado", variant: "secondary" },
  processing: { label: "Processando", variant: "warning" },
  awaiting_review: { label: "Aguardando revisão", variant: "default" },
  completed: { label: "Concluída", variant: "success" },
  rejected: { label: "Rejeitada", variant: "destructive" },
};

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  invoice: "Invoice",
  packing_list: "Packing List",
  bill_of_lading: "BL",
};

export const DOCUMENT_STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  extracted: "Extraído",
  failed: "Falhou",
};

export function normalizeImportKey(
  value: string | null | undefined,
): string | null {
  const next = value?.trim().replace(/\s+/g, " ").toUpperCase() ?? "";
  return next.length > 0 ? next : null;
}

export function fallbackSavedReference(params: {
  blNumber: string | null;
  invoiceNumber: string | null;
}): string | null {
  return params.blNumber ?? params.invoiceNumber;
}

const GENERATED_REFERENCE_RE = /^IMP-\d{8}-/i;

export function displayImportReference(row: {
  reference_number: string | null;
  invoice_number: string | null;
  bl_number: string | null;
}): string {
  const reference = normalizeImportKey(row.reference_number);
  if (!reference) return "";
  if (
    reference === normalizeImportKey(row.bl_number) ||
    reference === normalizeImportKey(row.invoice_number)
  ) {
    return "";
  }
  if (GENERATED_REFERENCE_RE.test(reference)) return "";
  return row.reference_number?.trim() ?? "";
}
