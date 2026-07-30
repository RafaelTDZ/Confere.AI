import type { Import } from "@confere/domain";
import type { AuditRepository, ImportRepository } from "../ports/repositories.js";

export interface CreateImportInput {
  tenantId: string;
  userId: string;
  referenceNumber: string;
  supplierName?: string;
  incoterm?: string;
  currency?: string;
}

export class CreateImport {
  constructor(
    private readonly imports: ImportRepository,
    private readonly audit: AuditRepository,
  ) {}

  async execute(input: CreateImportInput): Promise<Import> {
    if (!input.referenceNumber.trim()) {
      throw new Error("Numero de referencia e obrigatorio");
    }

    const created = await this.imports.insert({
      tenantId: input.tenantId,
      referenceNumber: input.referenceNumber.trim(),
      supplierName: input.supplierName ?? null,
      incoterm: input.incoterm ?? null,
      currency: input.currency ?? null,
      createdBy: input.userId,
    });

    await this.audit.insert({
      tenantId: input.tenantId,
      userId: input.userId,
      entity: "imports",
      entityId: created.id,
      action: "create",
      beforeState: null,
      afterState: { referenceNumber: created.referenceNumber },
    });

    return created;
  }
}
