import { NextResponse } from "next/server";
import { enqueueProcessImport, getUseCases } from "@/lib/container";
import { handleRouteError, requireAuth } from "@/lib/api";
import { NotFoundError, ValidationError } from "@confere/application";
import { isRequiredDocumentSetComplete } from "@confere/domain";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAuth({ write: true });
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { id } = await params;
    const { repos } = getUseCases();

    const importRecord = await repos.imports.findById(ctx.tenantId, id);
    if (!importRecord) throw new NotFoundError("Importacao", id);
    if (importRecord.status !== "uploaded") {
      throw new ValidationError(
        `Importacao nao pode ser processada no status "${importRecord.status}"`,
      );
    }

    const documents = await repos.documents.listByImport(ctx.tenantId, id);
    const confirmedTypes = documents
      .filter((doc) => doc.sha256)
      .map((doc) => doc.docType);
    if (!isRequiredDocumentSetComplete(confirmedTypes)) {
      throw new ValidationError(
        "Conjunto incompleto: confirme o upload de Invoice, Packing List e BL",
      );
    }

    await enqueueProcessImport({ importId: id, tenantId: ctx.tenantId });

    return NextResponse.json({ data: { enqueued: true } }, { status: 202 });
  } catch (error) {
    return handleRouteError(error);
  }
}
