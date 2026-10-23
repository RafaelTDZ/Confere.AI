import { createHash } from "node:crypto";

const MAX_ANALYZE_FILE_BYTES = 10 * 1024 * 1024;

const ALLOWED_MEDIA_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

export function normalizeMediaType(
  contentType: string | null | undefined,
  filename: string,
): string {
  const raw = (contentType ?? "").split(";")[0]?.trim().toLowerCase() || "";
  if (raw === "image/jpg") return "image/jpeg";
  if (ALLOWED_MEDIA_TYPES.has(raw)) {
    return raw === "image/jpg" ? "image/jpeg" : raw;
  }

  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";

  throw new Error(
    "Tipo de arquivo não suportado. Envie PDF, PNG, JPG ou WEBP.",
  );
}

export function assertAllowedFile(sizeBytes: number, mediaType: string) {
  if (sizeBytes <= 0) {
    throw new Error("Arquivo vazio");
  }
  if (sizeBytes > MAX_ANALYZE_FILE_BYTES) {
    throw new Error("Arquivo maior que 10 MB");
  }
  if (!ALLOWED_MEDIA_TYPES.has(mediaType) && mediaType !== "image/jpeg") {
    throw new Error(
      "Tipo de arquivo não suportado. Envie PDF, PNG, JPG ou WEBP.",
    );
  }
}

export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}
