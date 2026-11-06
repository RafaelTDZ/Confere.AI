import { NextResponse } from "next/server";
import { createLogger, createTimer } from "@/lib/observability/logger";
import { runWithAdminReads } from "@/lib/supabase/read-client";
import {
  enqueueDueTrackingShipments,
  processQueuedTrackingJobs,
} from "@/lib/tracking/service";
import { isFirecrawlConfigured } from "@/lib/tracking/firecrawl";

/** Cada scrape leva ~13s; 4 cabem no limite de 60s da Vercel Hobby. */
export const maxDuration = 60;

const log = createLogger("api/tracking/run");

const MAX_BATCH = 4;
/** Vencidos reenfileirados por execução: alimenta este e o próximo cron. */
const ENQUEUE_BATCH = 8;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(request: Request, method: "GET" | "POST") {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    log.error("cron_secret_missing", { method });
    return NextResponse.json(
      { error: "CRON_SECRET não configurado" },
      { status: 503 },
    );
  }
  if (!authorized(request)) {
    log.warn("unauthorized", { method });
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  // Sem FIRECRAWL_API_KEY o cron ainda drena os providers http (MSC, HMM, ONE,
  // Kuehne + Nagel); os portais que dependem do Firecrawl ficam `blocked` por
  // shipment em `scrapeShipment`.
  if (!isFirecrawlConfigured()) {
    log.warn("firecrawl_not_configured", { method });
  }

  const url = new URL(request.url);
  const requested = Number(url.searchParams.get("limit") ?? "3");
  const limit = Number.isInteger(requested)
    ? Math.min(Math.max(requested, 1), MAX_BATCH)
    : 3;

  const timer = createTimer();
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

  log.info("cron_finished", {
    method,
    limit,
    ...result,
    elapsedMs: timer.elapsedMs(),
  });

  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: Request) {
  const timer = createTimer();
  try {
    return await handle(request, "GET");
  } catch (error) {
    log.error("cron_failed", {
      method: "GET",
      elapsedMs: timer.elapsedMs(),
      error,
    });
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao processar rastreio",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const timer = createTimer();
  try {
    return await handle(request, "POST");
  } catch (error) {
    log.error("cron_failed", {
      method: "POST",
      elapsedMs: timer.elapsedMs(),
      error,
    });
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao processar rastreio",
      },
      { status: 500 },
    );
  }
}
