import { NextResponse } from "next/server";
import { z } from "zod";
import { getUseCases } from "@/lib/container";
import { handleRouteError, parseBody, requireAuth } from "@/lib/api";

const updateProductSchema = z.object({
  description: z.string().min(1).max(500).optional(),
  ncm: z.string().max(10).nullable().optional(),
  unitWeight: z.number().nullable().optional(),
  unitOfMeasure: z.string().max(10).nullable().optional(),
  attributes: z.record(z.unknown()).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAuth({ write: true });
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { id } = await params;
    const input = await parseBody(request, updateProductSchema);
    const { repos } = getUseCases();

    const product = await repos.products.update(ctx.tenantId, id, input);
    return NextResponse.json({ data: product });
  } catch (error) {
    return handleRouteError(error);
  }
}
