export const DOCUMENT_TYPES = [
  "invoice",
  "packing_list",
  "bill_of_lading",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_STATUSES = ["pending", "extracted", "failed"] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export interface ImportDocument {
  id: string;
  importId: string;
  tenantId: string;
  docType: DocumentType;
  storagePath: string;
  sha256: string;
  version: number;
  status: DocumentStatus;
  originalFilename: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  createdAt: Date;
}

export function isRequiredDocumentSetComplete(
  presentTypes: DocumentType[],
): boolean {
  return DOCUMENT_TYPES.every((type) => presentTypes.includes(type));
}

export function buildStoragePath(input: {
  tenantId: string;
  importId: string;
  docType: DocumentType;
  version: number;
  filename: string;
}): string {
  const safeName = input.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return [
    input.tenantId,
    input.importId,
    input.docType,
    `v${input.version}_${safeName}`,
  ].join("/");
}
