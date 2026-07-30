import type { ExtractedItem, Product } from "@confere/domain";
import { normalizeSku } from "@confere/domain";
import type {
  AuditRepository,
  ImportRepository,
  ProductMatchRepository,
  ProductRepository,
} from "../ports/repositories.js";
import { NotFoundError, ValidationError } from "../errors.js";

export interface ApprovedProductDecision {
  matchId: string;
  /** create: cadastra novo; update: atualiza cadastro existente com dados extraidos; ignore: nada faz. */
  action: "create" | "update" | "ignore";
  /** Correcoes editadas pelo usuario na revisao (sobrepoe dados extraidos). */
  corrections?: Partial<ExtractedItem>;
}

export interface ApproveImportInput {
  tenantId: string;
  userId: string;
  importId: string;
  decisions: ApprovedProductDecision[];
}

export interface ApproveImportResult {
  createdProducts: Product[];
  updatedProducts: Product[];
}

/**
 * Aplica a aprovacao do usuario: cadastra produtos novos, atualiza
 * existentes, registra auditoria e conclui a importacao.
 */
export class ApproveImport {
  constructor(
    private readonly imports: ImportRepository,
    private readonly products: ProductRepository,
    private readonly productMatches: ProductMatchRepository,
    private readonly audit: AuditRepository,
  ) {}

  async execute(input: ApproveImportInput): Promise<ApproveImportResult> {
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

    const matches = await this.productMatches.listByImport(
      input.tenantId,
      input.importId,
    );
    const matchesById = new Map(matches.map((m) => [m.id, m]));

    const createdProducts: Product[] = [];
    const updatedProducts: Product[] = [];

    for (const decision of input.decisions) {
      const match = matchesById.get(decision.matchId);
      if (!match) {
        throw new NotFoundError("ProductMatch", decision.matchId);
      }
      const data: ExtractedItem = {
        ...match.extractedData,
        ...decision.corrections,
      };

      if (decision.action === "create") {
        const product = await this.products.insert({
          tenantId: input.tenantId,
          sku: normalizeSku(data.sku),
          description: data.description,
          ncm: data.ncm ?? null,
          unitWeight: data.unitWeight ?? null,
          unitOfMeasure: data.unitOfMeasure ?? null,
          attributes: data.attributes ?? {},
          origin: "ai",
        });
        createdProducts.push(product);
        await this.audit.insert({
          tenantId: input.tenantId,
          userId: input.userId,
          entity: "products",
          entityId: product.id,
          action: "create_from_import",
          beforeState: null,
          afterState: { sku: product.sku, importId: input.importId },
        });
      }

      if (decision.action === "update" && match.productId) {
        const before = await this.products.findBySku(
          input.tenantId,
          data.sku,
        );
        const product = await this.products.update(
          input.tenantId,
          match.productId,
          {
            description: data.description,
            ncm: data.ncm ?? undefined,
            unitWeight: data.unitWeight ?? undefined,
            unitOfMeasure: data.unitOfMeasure ?? undefined,
            attributes: data.attributes ?? undefined,
          },
        );
        updatedProducts.push(product);
        await this.audit.insert({
          tenantId: input.tenantId,
          userId: input.userId,
          entity: "products",
          entityId: product.id,
          action: "update_from_import",
          beforeState: before
            ? {
                description: before.description,
                ncm: before.ncm,
                unitWeight: before.unitWeight,
                unitOfMeasure: before.unitOfMeasure,
              }
            : null,
          afterState: {
            description: product.description,
            ncm: product.ncm,
            unitWeight: product.unitWeight,
            unitOfMeasure: product.unitOfMeasure,
          },
        });
      }
    }

    await this.imports.updateStatus(input.tenantId, input.importId, "completed");
    await this.audit.insert({
      tenantId: input.tenantId,
      userId: input.userId,
      entity: "imports",
      entityId: input.importId,
      action: "approve",
      beforeState: { status: "awaiting_review" },
      afterState: { status: "completed" },
    });

    return { createdProducts, updatedProducts };
  }
}
