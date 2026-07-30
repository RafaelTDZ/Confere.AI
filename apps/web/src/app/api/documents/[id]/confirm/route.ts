import { NextResponse } from "next/server";
import { z } from "zod";
import { getUseCases } from "@/lib/container";
import { handleRouteError, parseBody, requireAuth } from "@/lib/api";

const confirmSchema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  contentType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAuth({ write: true });
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { id } = await params;
    const input = await parseBody(request, confirmSchema);
    const { confirmDocumentUpload } = getUseCases();

    await confirmDocumentUpload.execute({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      documentId: id,
      sha256: input.sha256,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
    });

    return NextResponse.json({ data: { confirmed: true } });
  } catch (error) {
    return handleRouteError(error);
  }
}
