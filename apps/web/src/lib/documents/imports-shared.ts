import type {
  BlExtraction,
  DocumentType,
  InvoiceExtraction,
} from "@/lib/ai/schemas";
import type {
  ConsigneeDefault,
  ConsigneeDivergence,
  ConsigneeSnapshot,
} from "@/lib/documents/consignee-check";
import {
  isInTransitTrackingStatus,
  isTerminalTrackingStatus,
} from "@/lib/tracking/shared";

export type ImportStatus =
  | "uploaded"
  | "processing"
  | "awaiting_review"
  | "completed"
  | "rejected"
  | "failed";

export type ImportRow = {
  id: string;
  reference_number: string | null;
  status: string;
  supplier_name: string | null;
  invoice_number: string | null;
  bl_number: string | null;
  created_at: string;
  consignee_divergences?: ConsigneeDivergence[] | null;
  eta?: string | null;
  onboardDate?: string | null;
  trackingStatus?: string | null;
};

export type ImportShipmentStage = "awaiting_shipment" | "in_transit" | "arrived";

export const IMPORT_DOCUMENT_TYPES: DocumentType[] = [
  "invoice",
  "packing_list",
  "bill_of_lading",
];

export type ImportPartySummary = {
  id: string;
  name: string;
};

type ImportDocumentRow = {
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
  defaultConsignee: ConsigneeDefault | null;
  documentConsignee: ConsigneeSnapshot | null;
  consigneeDivergences: ConsigneeDivergence[];
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
  processing: { label: "Processando", variant: "default" },
  awaiting_review: { label: "Aguardando revisão", variant: "warning" },
  completed: { label: "Concluída", variant: "success" },
  rejected: { label: "Rejeitada", variant: "destructive" },
  failed: { label: "Falhou", variant: "destructive" },
};

export const IMPORT_SHIPMENT_STAGE_LABELS: Record<ImportShipmentStage, string> =
  {
    awaiting_shipment: "Aguardando embarque",
    in_transit: "Em trânsito",
    arrived: "Chegada confirmada",
  };

/** Status de rastreio de chegada: final (entregue/devolvido) ou já descarregado no porto. */
function isArrivedTrackingStatus(status: string): boolean {
  return (
    isTerminalTrackingStatus(status) ||
    status === "arrived" ||
    status === "discharged"
  );
}

/** Prioridade do status ao escolher o mais relevante: chegada > em trânsito > demais. */
export function trackingStatusPriority(status: string): number {
  if (isArrivedTrackingStatus(status)) return 3;
  if (isInTransitTrackingStatus(status)) return 2;
  return 1;
}

export function importShipmentStage(input: {
  onboardDate?: string | null;
  status?: string | null;
}): ImportShipmentStage {
  const status = input.status?.trim() ?? "";
  if (status && isArrivedTrackingStatus(status)) return "arrived";
  if (input.onboardDate?.trim() || status) return "in_transit";
  return "awaiting_shipment";
}

export const IMPORT_SORT_LABELS = {
  created_desc: "Mais recentes",
  created_asc: "Mais antigas",
  reference_asc: "Referência A-Z",
  reference_desc: "Referência Z-A",
  eta_asc: "ETA mais próxima",
  eta_desc: "ETA mais distante",
} as const;

export type ImportSort = keyof typeof IMPORT_SORT_LABELS;

const DEFAULT_IMPORT_SORT: ImportSort = "created_desc";

export function normalizeImportSort(value: unknown): ImportSort {
  if (typeof value !== "string") return DEFAULT_IMPORT_SORT;
  return Object.prototype.hasOwnProperty.call(IMPORT_SORT_LABELS, value)
    ? (value as ImportSort)
    : DEFAULT_IMPORT_SORT;
}

/**
 * DD/MM/AAAA → `YYYY-MM-DD` (coluna `date`). Devolve `null` para vazio ou para
 * data inexistente (ex.: 31/02/2026).
 */
export function etaBrToIsoDate(value: string | null | undefined): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value?.trim() ?? "");
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${match[3]}-${match[2]}-${match[1]}`;
}

/** `YYYY-MM-DD` (coluna `date`) → DD/MM/AAAA, o formato exibido na listagem. */
export function formatIsoDateBr(value: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value?.trim() ?? "");
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
}

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
