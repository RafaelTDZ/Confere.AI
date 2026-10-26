import { NextResponse } from "next/server";
import { processNextAiJob } from "@/lib/documents/ai-worker";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_JOBS_PER_RUN = 3;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Drena a fila de análise. Serve de retry para jobs órfãos (worker morto) e de
 * alvo para o Vercel Cron (`CRON_SECRET` via `Authorization: Bearer`).
 */
async function drainQueue(request: Request) {
  if (!process.env.CRON_SECRET?.trim()) {
    return NextResponse.json(
      { error: "CRON_SECRET não configurado" },
      { status: 503 },
    );
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let processed = 0;
  try {
    while (processed < MAX_JOBS_PER_RUN && (await processNextAiJob())) {
      processed += 1;
    }
  } catch (error) {
    console.error("[api/ai/jobs/run]", error);
    return NextResponse.json(
      { error: "Falha ao processar a fila", processed },
      { status: 500 },
    );
  }

  return NextResponse.json({ processed });
}

export async function POST(request: Request) {
  return drainQueue(request);
}

export async function GET(request: Request) {
  return drainQueue(request);
}
