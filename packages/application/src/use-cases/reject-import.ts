import type {
  AuditRepository,
  ImportRepository,
} from "../ports/repositories.js";
import { NotFoundError, ValidationError } from "../errors.js";

export interface RejectImportInput {
  tenantId: string;
  userId: string;
  importId: string;
  reason: string;
}

export class RejectImport {
  constructor(
    private readonly imports: ImportRepository,
    private readonly audit: AuditRepository,
  ) {}

  async execute(input: RejectImportInput): Promise<void> {
    const importRecord = await this.imports.findById(
      input.tenantId,
      input.importId,
    );
    if (!importRecord) throw new NotFoundError("Importacao", input.importId);
    if (importRecord.status !== "awaiting_review") {
      throw new ValidationError(
        `Importacao nao esta aguardando revisao (status: ${importRecord.status})`,
      );
    }

    await this.imports.updateStatus(input.tenantId, input.importId, "rejected");
    await this.audit.insert({
      tenantId: input.tenantId,
      userId: input.userId,
      entity: "imports",
      entityId: input.importId,
      action: "reject",
      beforeState: { status: "awaiting_review" },
      afterState: { status: "rejected", reason: input.reason },
    });
  }
}
