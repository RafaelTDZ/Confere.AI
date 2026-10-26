import { NextResponse } from "next/server";
import { getAuthContext, UnauthorizedError } from "@/lib/auth";
import { getAiJobForTenant } from "@/lib/documents/ai-jobs";

export const runtime = "nodejs";

const JOB_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const auth = await getAuthContext();
    const { jobId } = await context.params;

    if (!JOB_ID_RE.test(jobId)) {
      return NextResponse.json(
        { error: "Job não encontrado" },
        { status: 404 },
      );
    }

    const job = await getAiJobForTenant(auth.tenantId, jobId);
    if (!job) {
      return NextResponse.json(
        { error: "Job não encontrado" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      importId: job.result?.importId ?? job.import_id,
      types: job.result?.types ?? [],
      deduped: job.result?.deduped ?? false,
      errorMessage: job.error_message,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: "Usuário não autenticado" },
        { status: 401 },
      );
    }
    console.error("[api/ai/jobs GET]", error);
    return NextResponse.json(
      { error: "Falha ao consultar job de análise" },
      { status: 500 },
    );
  }
}
