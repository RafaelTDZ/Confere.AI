export const IMPORT_STATUSES = [
  "uploaded",
  "processing",
  "awaiting_review",
  "completed",
  "rejected",
] as const;

export type ImportStatus = (typeof IMPORT_STATUSES)[number];

export interface Import {
  id: string;
  tenantId: string;
  referenceNumber: string;
  status: ImportStatus;
  supplierName: string | null;
  incoterm: string | null;
  currency: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const IMPORT_TRANSITIONS: Record<ImportStatus, ImportStatus[]> = {
  uploaded: ["processing", "rejected"],
  processing: ["awaiting_review", "uploaded", "rejected"],
  awaiting_review: ["completed", "rejected", "processing"],
  completed: [],
  rejected: ["uploaded"],
};

export function canTransition(from: ImportStatus, to: ImportStatus): boolean {
  return IMPORT_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ImportStatus, to: ImportStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Transicao de importacao invalida: ${from} -> ${to}`);
  }
}
