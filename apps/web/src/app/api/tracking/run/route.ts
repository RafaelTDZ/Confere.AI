import { NextResponse } from "next/server";
import { runWithAdminReads } from "@/lib/supabase/read-client";
import {
  enqueueDueTrackingShipments,
  processQueuedTrackingJobs,
} from "@/lib/tracking/service";
import { isFirecrawlConfigured } from "@/lib/tracking/firecrawl";

/** Cada scrape leva ~13s; 4 cabem no limite de 60s da Vercel Hobby. */
export const maxDuration = 60;

const MAX_BATCH = 4;
/** Vencidos reenfileirados por execução: alimenta este e o próximo cron. */
const ENQUEUE_BATCH = 8;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET não configurado" },
      { status: 503 },
    );
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  if (!isFirecrawlConfigured()) {
    return NextResponse.json(
      { error: "FIRECRAWL_API_KEY não configurada", processed: 0, failed: 0 },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const requested = Number(url.searchParams.get("limit") ?? "3");
  const limit = Number.isInteger(requested)
    ? Math.min(Math.max(requested, 1), MAX_BATCH)
    : 3;

  const result = await runWithAdminReads(async () => {
    // A fila não se realimenta sozinha: sem enfileirar os vencidos por
    // `next_check_at`, a cadência semanal/diária pararia após a 1ª consulta.
    const { queued } = await enqueueDueTrackingShipments({
      limit: ENQUEUE_BATCH,
    });
    const processed = await processQueuedTrackingJobs({
      limit,
      worker: "cron",
    });
    return { queued, ...processed };
  });

  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: Request) {
  try {
    return await handle(request);
  } catch (error) {
    console.error("[api/tracking/run GET]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao processar rastreio",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    return await handle(request);
  } catch (error) {
    console.error("[api/tracking/run POST]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao processar rastreio",
      },
      { status: 500 },
    );
  }
}
