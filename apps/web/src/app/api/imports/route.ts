import { NextResponse } from "next/server";
import { z } from "zod";
import { getUseCases } from "@/lib/container";
import { handleRouteError, parseBody, requireAuth } from "@/lib/api";

const createImportSchema = z.object({
  referenceNumber: z.string().min(1).max(100),
  supplierName: z.string().max(200).optional(),
  incoterm: z.string().max(10).optional(),
  currency: z.string().length(3).optional(),
});

export async function GET(request: Request) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") ?? undefined;
    const { repos } = getUseCases();
    const imports = await repos.imports.listByTenant(ctx.tenantId, {
      status: status as never,
      limit: 50,
    });
    return NextResponse.json({ data: imports });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  const ctx = await requireAuth({ write: true });
  if (ctx instanceof NextResponse) return ctx;

  try {
    const input = await parseBody(request, createImportSchema);
    const { createImport } = getUseCases();
    const created = await createImport.execute({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      referenceNumber: input.referenceNumber,
      supplierName: input.supplierName,
      incoterm: input.incoterm,
      currency: input.currency,
    });
    return NextResponse.json({ data: created }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
