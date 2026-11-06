import { after, NextResponse } from "next/server";
import { createLogger } from "@/lib/observability/logger";
import { getAuthContext, UnauthorizedError } from "@/lib/auth";
import {
  getImportDetail,
  deleteImportRecord,
  ImportConflictError,
  ImportNotFoundError,
  ImportValidationError,
  updateImportExtractionData,
  updateImportRecord,
} from "@/lib/documents";
import {
  BL_EDITABLE_LIST_FIELDS,
  BL_EDITABLE_TEXT_FIELDS,
  type BlEditablePatch,
  type ImportExtractionPatch,
  type ImportProductPatch,
} from "@/lib/documents/import-edit-shared";
import {
  enqueueTrackingForImport,
  processQueuedTrackingJobs,
} from "@/lib/tracking/service";

/** `after()` roda o rastreio depois da resposta; o teto cobre o pior scrape. */
export const maxDuration = 120;

/**
 * Campos do BL que mudam **qual** consulta o rastreio faz. Corrigir o armador
 * (caso OYH140: LX Pantos → CMA CGM) troca o alvo consultável do BL para o
 * primeiro container; sem isso a edição fica só no formulário.
 */
const TRACKING_BL_FIELDS = [
  "number",
  "masterBlNumber",
  "carrier",
  "containerNumbers",
] as const;

function touchesTracking(bl: BlEditablePatch | undefined): boolean {
  if (!bl) return false;
  return TRACKING_BL_FIELDS.some((field) => field in bl);
}

type RouteContext = {
  params: Promise<{ id: string }>;
};

const BL_TEXT_FIELD_SET = new Set<string>(BL_EDITABLE_TEXT_FIELDS);
const BL_LIST_FIELD_SET = new Set<string>(BL_EDITABLE_LIST_FIELDS);

function emptyToNull(value: string): string | null {
  const next = value.trim();
  return next.length > 0 ? next : null;
}

function parseBlPatch(value: unknown): BlEditablePatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ImportValidationError("Dados do BL inválidos");
  }

  const patch: Record<string, string | null | string[]> = {};
  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    if (BL_TEXT_FIELD_SET.has(key)) {
      if (field !== null && typeof field !== "string") {
        throw new ImportValidationError(`Campo do BL inválido: ${key}`);
      }
      patch[key] = typeof field === "string" ? emptyToNull(field) : null;
      continue;
    }
    if (BL_LIST_FIELD_SET.has(key)) {
      if (
        !Array.isArray(field) ||
        field.some((item) => typeof item !== "string")
      ) {
        throw new ImportValidationError(`Campo do BL inválido: ${key}`);
      }
      patch[key] = field.map((item) => (item as string).trim()).filter(Boolean);
      continue;
    }
    throw new ImportValidationError(`Campo do BL desconhecido: ${key}`);
  }

  return patch as BlEditablePatch;
}

function parseProducts(value: unknown): ImportProductPatch[] {
  if (!Array.isArray(value)) {
    throw new ImportValidationError("Produtos inválidos");
  }

  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ImportValidationError("Produto inválido");
    }
    const row = item as Record<string, unknown>;
    const parsed: ImportProductPatch = {
      code: null,
      ncm: null,
      description: null,
    };
    for (const key of ["code", "ncm", "description"] as const) {
      const field = row[key];
      if (field !== undefined && field !== null && typeof field !== "string") {
        throw new ImportValidationError("Produto inválido");
      }
      parsed[key] = typeof field === "string" ? emptyToNull(field) : null;
    }
    return parsed;
  });
}

function parseImportPatch(body: unknown): {
  referenceNumber?: string;
  supplierName?: string | null;
  extraction: ImportExtractionPatch;
} {
  if (!body || typeof body !== "object") {
    throw new ImportValidationError("Informe os dados da importação");
  }

  const row = body as Record<string, unknown>;
  if ("referenceNumber" in row && typeof row.referenceNumber !== "string") {
    throw new ImportValidationError("Referência inválida");
  }

  const patch: {
    referenceNumber?: string;
    supplierName?: string | null;
    extraction: ImportExtractionPatch;
  } = { extraction: {} };

  if (typeof row.referenceNumber === "string") {
    patch.referenceNumber = row.referenceNumber;
  }

  if ("supplierName" in row) {
    if (row.supplierName !== null && typeof row.supplierName !== "string") {
      throw new ImportValidationError("Fornecedor inválido");
    }
    patch.supplierName = row.supplierName as string | null;
  }

  for (const key of ["invoiceNumber", "blNumber"] as const) {
    if (!(key in row)) continue;
    const value = row[key];
    if (value !== null && typeof value !== "string") {
      throw new ImportValidationError(
        key === "invoiceNumber"
          ? "Número da invoice inválido"
          : "Número do BL inválido",
      );
    }
    patch.extraction[key] = value;
  }

  if ("bl" in row) {
    patch.extraction.bl = parseBlPatch(row.bl);
  }

  if ("products" in row) {
    patch.extraction.products = parseProducts(row.products);
  }

  const hasExtraction = Object.keys(patch.extraction).length > 0;
  if (patch.referenceNumber === undefined && !hasExtraction) {
    throw new ImportValidationError("Informe os dados da importação");
  }

  return patch;
}

const log = createLogger("api/imports");

export async function GET(_request: Request, context: RouteContext) {
  try {
    const auth = await getAuthContext();
    const { id } = await context.params;
    const detail = await getImportDetail(auth.tenantId, id);
    return NextResponse.json(detail);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: "Usuário não autenticado" },
        { status: 401 },
      );
    }
    if (error instanceof ImportNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    log.error("request_failed", { error });
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao carregar importação",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await getAuthContext();
    if (auth.role === "viewer") {
      return NextResponse.json(
        { error: "Perfil viewer não pode alterar importações" },
        { status: 403 },
      );
    }

    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    const patch = parseImportPatch(body);

    let detail =
      patch.referenceNumber !== undefined || patch.supplierName !== undefined
        ? await updateImportRecord(auth.tenantId, id, {
            referenceNumber: patch.referenceNumber ?? "",
            supplierName: patch.supplierName,
          })
        : null;

    if (Object.keys(patch.extraction).length > 0) {
      detail = await updateImportExtractionData(
        auth.tenantId,
        detail?.id ?? id,
        patch.extraction,
      );
    }

    // Recalcula os alvos do rastreio quando a edição muda o BL/armador/containers
    // e consulta na hora: a resposta não espera o scrape (pode levar ~15s).
    if (touchesTracking(patch.extraction.bl)) {
      const importId = detail?.id ?? id;
      const tenantId = auth.tenantId;
      after(async () => {
        try {
          const enqueued = await enqueueTrackingForImport({
            tenantId,
            importId,
          });
          if (enqueued.queued > 0) {
            await processQueuedTrackingJobs({
              importId,
              limit: 1,
              worker: "refresh",
            });
          }
        } catch (error) {
          log.error("tracking_reconcile_failed", {
            tenantId,
            importId,
            error,
          });
        }
      });
    }

    return NextResponse.json({
      ok: true,
      import: detail ?? (await getImportDetail(auth.tenantId, id)),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: "Usuário não autenticado" },
        { status: 401 },
      );
    }
    if (error instanceof ImportNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof ImportValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof ImportConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    log.error("request_failed", { error });
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao atualizar importação",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const auth = await getAuthContext();
    if (auth.role === "viewer") {
      return NextResponse.json(
        { error: "Perfil viewer não pode remover importações" },
        { status: 403 },
      );
    }

    const { id } = await context.params;
    await deleteImportRecord(auth.tenantId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: "Usuário não autenticado" },
        { status: 401 },
      );
    }
    if (error instanceof ImportNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    log.error("request_failed", { error });
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao remover importação",
      },
      { status: 500 },
    );
  }
}
