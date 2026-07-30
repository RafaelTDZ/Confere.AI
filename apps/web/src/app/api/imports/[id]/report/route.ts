import { NextResponse } from "next/server";
import { getUseCases } from "@/lib/container";
import { handleRouteError, requireAuth } from "@/lib/api";
import { NotFoundError } from "@confere/application";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { id } = await params;
    const { repos } = getUseCases();

    const importRecord = await repos.imports.findById(ctx.tenantId, id);
    if (!importRecord) throw new NotFoundError("Importacao", id);

    const [documents, analyses, matches] = await Promise.all([
      repos.documents.listByImport(ctx.tenantId, id),
      repos.analyses.listByImport(ctx.tenantId, id),
      repos.productMatches.listByImport(ctx.tenantId, id),
    ]);

    return NextResponse.json({
      data: {
        import: importRecord,
        documents,
        analyses,
        matches,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
