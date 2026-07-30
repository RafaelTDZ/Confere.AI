import { NextResponse } from "next/server";
import { z } from "zod";
import { getUseCases } from "@/lib/container";
import { handleRouteError, parseBody, requireAuth } from "@/lib/api";

const rejectSchema = z.object({
  reason: z.string().min(3).max(500),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAuth({ write: true });
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { id } = await params;
    const input = await parseBody(request, rejectSchema);
    const { rejectImport } = getUseCases();

    await rejectImport.execute({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      importId: id,
      reason: input.reason,
    });

    return NextResponse.json({ data: { rejected: true } });
  } catch (error) {
    return handleRouteError(error);
  }
}
