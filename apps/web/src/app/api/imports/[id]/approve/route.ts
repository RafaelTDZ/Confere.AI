import { NextResponse } from "next/server";
import { z } from "zod";
import { getUseCases } from "@/lib/container";
import { handleRouteError, parseBody, requireAuth } from "@/lib/api";

const approveSchema = z.object({
  decisions: z
    .array(
      z.object({
        matchId: z.string().uuid(),
        action: z.enum(["create", "update", "ignore"]),
        corrections: z
          .object({
            sku: z.string().optional(),
            description: z.string().optional(),
            ncm: z.string().nullable().optional(),
            unitWeight: z.number().nullable().optional(),
            unitOfMeasure: z.string().nullable().optional(),
          })
          .optional(),
      }),
    )
    .max(500),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAuth({ write: true });
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { id } = await params;
    const input = await parseBody(request, approveSchema);
    const { approveImport } = getUseCases();

    const result = await approveImport.execute({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      importId: id,
      decisions: input.decisions,
    });

    return NextResponse.json({ data: result });
  } catch (error) {
    return handleRouteError(error);
  }
}
