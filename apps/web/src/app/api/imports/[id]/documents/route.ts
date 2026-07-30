import { NextResponse } from "next/server";
import { z } from "zod";
import { getUseCases } from "@/lib/container";
import { handleRouteError, parseBody, requireAuth } from "@/lib/api";

const prepareUploadSchema = z.object({
  docType: z.enum(["invoice", "packing_list", "bill_of_lading"]),
  filename: z.string().min(1).max(255),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAuth({ write: true });
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { id } = await params;
    const input = await parseBody(request, prepareUploadSchema);
    const { prepareDocumentUpload } = getUseCases();

    const result = await prepareDocumentUpload.execute({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      importId: id,
      docType: input.docType,
      filename: input.filename,
    });

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
