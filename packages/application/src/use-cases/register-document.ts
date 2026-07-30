import type { DocumentType, ImportDocument } from "@confere/domain";
import { buildStoragePath } from "@confere/domain";
import type { FileStorage, SignedUploadTarget } from "../ports/file-storage.js";
import type {
  AuditRepository,
  DocumentRepository,
  ImportRepository,
} from "../ports/repositories.js";
import { NotFoundError, ValidationError } from "../errors.js";

export interface PrepareDocumentUploadInput {
  tenantId: string;
  userId: string;
  importId: string;
  docType: DocumentType;
  filename: string;
}

export interface PrepareDocumentUploadResult {
  document: ImportDocument;
  upload: SignedUploadTarget;
}

/**
 * Prepara o upload: cria o registro do documento (nova versao) e emite
 * signed URL. O arquivo sobe direto do navegador para o Storage.
 */
export class PrepareDocumentUpload {
  constructor(
    private readonly imports: ImportRepository,
    private readonly documents: DocumentRepository,
    private readonly storage: FileStorage,
    private readonly audit: AuditRepository,
  ) {}

  async execute(
    input: PrepareDocumentUploadInput,
  ): Promise<PrepareDocumentUploadResult> {
    const importRecord = await this.imports.findById(
      input.tenantId,
      input.importId,
    );
    if (!importRecord) throw new NotFoundError("Importacao", input.importId);

    const previous = await this.documents.findLatestVersion(
      input.tenantId,
      input.importId,
      input.docType,
    );
    const version = (previous?.version ?? 0) + 1;

    const path = buildStoragePath({
      tenantId: input.tenantId,
      importId: input.importId,
      docType: input.docType,
      version,
      filename: input.filename,
    });

    const upload = await this.storage.createSignedUploadUrl(path);

    const document = await this.documents.insert({
      tenantId: input.tenantId,
      importId: input.importId,
      docType: input.docType,
      storagePath: path,
      sha256: "",
      version,
      status: "pending",
      originalFilename: input.filename,
      contentType: null,
      sizeBytes: null,
    });

    await this.audit.insert({
      tenantId: input.tenantId,
      userId: input.userId,
      entity: "documents",
      entityId: document.id,
      action: "register_upload",
      beforeState: previous ? { version: previous.version } : null,
      afterState: { version, docType: input.docType },
    });

    return { document, upload };
  }
}

export interface ConfirmDocumentUploadInput {
  tenantId: string;
  userId: string;
  documentId: string;
  sha256: string;
  contentType: string;
  sizeBytes: number;
}

/** Confirma o upload e registra hash/metadados do arquivo enviado. */
export class ConfirmDocumentUpload {
  constructor(private readonly documents: DocumentRepository) {}

  async execute(input: ConfirmDocumentUploadInput): Promise<void> {
    const document = await this.documents.findById(
      input.tenantId,
      input.documentId,
    );
    if (!document) throw new NotFoundError("Documento", input.documentId);
    if (!/^[a-f0-9]{64}$/i.test(input.sha256)) {
      throw new ValidationError("sha256 invalido");
    }
    await this.documents.confirmUpload(input.tenantId, input.documentId, {
      sha256: input.sha256.toLowerCase(),
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
    });
  }
}
