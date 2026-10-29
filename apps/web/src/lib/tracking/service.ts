import "server-only";

import { createHash } from "node:crypto";
import type { Database, Json } from "@/lib/supabase/database.types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getReadClient } from "@/lib/supabase/read-client";
import { getImportDetail, syncImportEta } from "@/lib/documents/imports";
import {
  detectCarrier,
  inferCarrier,
  carrierSupportsContainer,
  type CarrierCode,
} from "@/lib/tracking/carriers";
import { carrierFromBlPrefix, looksLikeCarrierBl } from "@/lib/tracking/bl-prefix";
import {
  estimateFirecrawlCredits,
  isFirecrawlConfigured,
  scrapeWithFirecrawl,
} from "@/lib/tracking/firecrawl";
import { buildCarrierActions, buildCarrierScrapeUrl } from "@/lib/tracking/carrier-actions";
import { fetchMscTracking } from "@/lib/tracking/providers/msc";
import { fetchHmmTracking } from "@/lib/tracking/providers/hmm";
import { fetchOneTracking } from "@/lib/tracking/providers/one";
import {
  getTrackingCreditsUsed,
  consumeTrackingCredits,
} from "@/lib/tracking/usage";
import {
  inferTrackingStatus,
  normalizeFirecrawlResult,
  parseTrackingDate,
  type NormalizedTrackingSnapshot,
} from "@/lib/tracking/normalize";
import {
  isTerminalTrackingStatus,
  TRACKING_STATUSES,
  type ImportTracking,
  type TrackingEvent,
  type TrackingQueryType,
  type TrackingShipment,
  type TrackingStatus,
} from "@/lib/tracking/shared";
import {
  trackingContainerFallbackLimit,
  trackingFarEtaIntervalMs,
  trackingFirecrawlMode,
  trackingInTransitIntervalMs,
  trackingMonthlyCreditBudget,
  trackingRefreshCooldownMinutes,
  trackingStrategyForCarrier,
} from "@/lib/tracking/config";
import {
  normalizeBlNumber,
  normalizeTrackingNumber,
  validContainerNumbers,
} from "@/lib/tracking/validate";

type ShipmentRow =
  Database["public"]["Tables"]["tracking_shipments"]["Row"];
type EventRow = Database["public"]["Tables"]["tracking_events"]["Row"];
type JobRow = Database["public"]["Tables"]["tracking_jobs"]["Row"];

type TrackingTarget = {
  queryType: TrackingQueryType;
  queryValue: string;
  containerNumber: string | null;
  /** "link" mantém o alvo visível sem gastar crédito (ex.: BL de casa na CMA). */
  strategy?: "link";
};

type TrackingBlPayload = {
  number?: string | null;
  masterBlNumber?: string | null;
  containerNumbers?: string[];
};

const HOUR_MS = 60 * 60 * 1000;

/** Vencidos reenfileirados por execução do cron (o processamento drena 4). */
const DEFAULT_DUE_ENQUEUE_LIMIT = 8;

/**
 * Status que ainda aceitam consulta automática. `delivered`/`empty_returned`
 * são terminais e ficam com `next_check_at` nulo — sem este filtro, o
 * reenfileiramento por vencimento os pegaria para sempre.
 */
const NON_TERMINAL_STATUSES = TRACKING_STATUSES.filter(
  (status) => !isTerminalTrackingStatus(status),
);

function mapShipment(row: ShipmentRow): TrackingShipment {
  return {
    id: row.id,
    importId: row.import_id,
    carrierCode: row.carrier_code,
    strategy: row.strategy as TrackingShipment["strategy"],
    queryType: row.query_type as TrackingQueryType,
    queryValue: row.query_value,
    containerNumber: row.container_number,
    status: row.status as TrackingStatus,
    vessel: row.vessel,
    voyage: row.voyage,
    eta: row.eta,
    lastEventAt: row.last_event_at,
    lastEventLocation: row.last_event_location,
    lastEventDescription: row.last_event_description,
    source: row.source as TrackingShipment["source"],
    fetchedAt: row.fetched_at,
    nextCheckAt: row.next_check_at,
    attempts: row.attempts,
    errorCode: row.error_code,
    errorMessage: row.error_message,
  };
}

function mapEvent(row: EventRow): TrackingEvent {
  return {
    id: row.id,
    shipmentId: row.shipment_id,
    eventAt: row.event_at,
    status: row.status,
    location: row.location,
    description: row.description,
    vessel: row.vessel,
    voyage: row.voyage,
    containerNumber: row.container_number,
    source: row.source as TrackingEvent["source"],
    createdAt: row.created_at,
  };
}

/**
 * Número do BL que será consultado no portal do armador.
 *
 * Ordem de produto (uma consulta por importação):
 * 1. BL do documento, quando tem o prefixo/formato do armador (master emitido
 *    pelo armador);
 * 2. BL master informado no documento (consolidação), quando o BL de casa não
 *    tem o prefixo;
 * 3. nenhum — o BL fica `link` e o primeiro container assume a consulta.
 *
 * Armador `unknown` não permite decidir (`looksLikeCarrierBl` devolve `true`),
 * então o BL do documento continua sendo a primeira escolha.
 */
function pickTrackingBlNumber(params: {
  blNumber: string | null;
  masterBlNumber: string | null;
  carrier: CarrierCode;
}): string | null {
  const house = normalizeBlNumber(params.blNumber);
  const master = normalizeBlNumber(params.masterBlNumber);

  if (house && looksLikeCarrierBl(params.carrier, house)) return house;
  if (master && looksLikeCarrierBl(params.carrier, master)) return master;
  return null;
}

/**
 * Alvos do rastreio da importação. Regra de produto: **uma consulta por
 * importação** — o BL e os containers descrevem o mesmo embarque, então não se
 * paga crédito duas vezes pelo mesmo dado.
 *
 * - BL consultável (estratégia efetiva ≠ `link`): o BL (do documento ou o
 *   **master** da consolidação) é a única consulta; **todos** os containers
 *   viram `link` (seguem visíveis na tela e aceitam evento manual, mas não são
 *   consultados pelo cron nem pelo botão).
 * - BL `link` (BL de casa sem master, CMA/MSC): apenas o **primeiro** container
 *   válido é consultável; os demais viram `link`.
 * - Sem BL: vale a mesma regra do BL `link` (primeiro container consultável).
 * - Armador sem suporte a container (ou estratégia `link`, ex.: OOCL): tudo
 *   fica `link` e o rastreio é manual pelo portal.
 *
 * As regras por armador continuam: a Evergreen mantém até 8 containers para
 * exibição e a OOCL fica toda em `link` (captcha).
 */
export function buildTrackingTargets(
  blNumber: string | null,
  blPayload: TrackingBlPayload | null,
  containerLimit = trackingContainerFallbackLimit(),
  carrier?: CarrierCode,
): TrackingTarget[] {
  const targets: TrackingTarget[] = [];
  // Sem armador identificado, o prefixo do master ainda revela o portal
  // (ex.: house `SASE...` + master `HLCU...` → Hapag).
  const effectiveCarrier =
    carrier && carrier !== "unknown"
      ? carrier
      : (carrierFromBlPrefix(blPayload?.masterBlNumber) ?? carrier ?? "unknown");
  const carrierStrategy = trackingStrategyForCarrier(effectiveCarrier);
  const queryBl = pickTrackingBlNumber({
    blNumber: blNumber ?? blPayload?.number ?? null,
    masterBlNumber: blPayload?.masterBlNumber ?? null,
    carrier: effectiveCarrier,
  });

  if (queryBl) {
    targets.push({
      queryType: "bl",
      queryValue: queryBl,
      containerNumber: null,
      ...(carrierStrategy === "link" ? { strategy: "link" as const } : {}),
    });
  } else {
    // BL de casa sem master rastreável: o shipment continua visível (link),
    // mas quem consulta é o primeiro container.
    const houseBl = normalizeBlNumber(
      blNumber ?? blPayload?.number ?? null,
    );
    if (houseBl) {
      targets.push({
        queryType: "bl",
        queryValue: houseBl,
        containerNumber: null,
        strategy: "link",
      });
    }
  }

  const effectiveLimit =
    effectiveCarrier === "evergreen"
      ? Math.max(containerLimit, 8)
      : containerLimit;
  const containers = validContainerNumbers(
    blPayload?.containerNumbers ?? [],
    effectiveLimit,
  );

  // O BL consultável cobre os containers; sem ele, só o primeiro container
  // válido assume a consulta — e apenas se o portal aceitar container.
  const blConsultable = Boolean(queryBl) && carrierStrategy !== "link";
  const canQueryContainer =
    carrierStrategy !== "link" &&
    carrierSupportsContainer(effectiveCarrier);
  const containerTarget =
    blConsultable || !canQueryContainer ? null : (containers[0] ?? null);

  for (const container of containers) {
    const consultable = container === containerTarget;
    targets.push({
      queryType: "container",
      queryValue: container,
      containerNumber: container,
      ...(consultable ? {} : { strategy: "link" as const }),
    });
  }

  return targets;
}

/**
 * Armador efetivo do rastreio: o texto/navio/containers do BL e, como último
 * recurso, o prefixo do master BL (ex.: documento do forwarder sem armador
 * identificável, mas com master `HLCU...`).
 */
function resolveTrackingCarrier(
  bl: {
    carrier?: string | null;
    containerNumbers?: string[];
    vessel?: string | null;
    masterBlNumber?: string | null;
  } | null,
): CarrierCode {
  const detected = inferCarrier(
    bl?.carrier,
    bl?.containerNumbers ?? [],
    bl?.vessel,
  );
  if (detected !== "unknown") return detected;
  return carrierFromBlPrefix(bl?.masterBlNumber) ?? "unknown";
}

function nextCheckAtFor(params: {
  status: TrackingStatus;
  eta: string | null;
  attempts: number;
}): string | null {
  if (isTerminalTrackingStatus(params.status)) return null;

  let delay =
    params.status === "not_found"
      ? 24 * HOUR_MS
      : params.eta && daysUntil(params.eta) <= 7
        ? trackingInTransitIntervalMs()
        : trackingFarEtaIntervalMs();

  // Backoff em falhas consecutivas (máx. 24h).
  if (params.status === "error" || params.status === "blocked") {
    delay = Math.min(24 * HOUR_MS, HOUR_MS * 2 ** Math.min(params.attempts, 5));
  }

  // Jitter de até 10% evita rajadas no mesmo minuto.
  const jitter = delay * 0.1 * Math.random();
  return new Date(Date.now() + delay + jitter).toISOString();
}

function daysUntil(date: string): number {
  const target = new Date(`${date}T00:00:00.000Z`).getTime();
  if (Number.isNaN(target)) return Number.POSITIVE_INFINITY;
  return Math.ceil((target - Date.now()) / (24 * HOUR_MS));
}

/**
 * Enfileira o rastreio da importação (idempotente). Não faz chamada externa:
 * o processamento fica para a primeira consulta da análise
 * (`processQueuedTrackingJobs` com `importId`), o botão manual ou o cron.
 *
 * Cria/atualiza os shipments de todos os alvos (BL + containers) e deixa
 * **apenas um** consultável — o escolhido por `buildTrackingTargets`; os
 * demais ficam `link`.
 */
export async function enqueueTrackingForImport(params: {
  tenantId: string;
  importId: string;
}): Promise<{ shipments: number; queued: number }> {
  const detail = await getImportDetail(params.tenantId, params.importId);
  const bl = detail.bl;
  const carrier = resolveTrackingCarrier(bl);
  const targets = buildTrackingTargets(
    detail.bl_number,
    bl,
    undefined,
    carrier,
  );

  if (targets.length === 0) {
    return { shipments: 0, queued: 0 };
  }

  const admin = createSupabaseAdminClient();
  const strategy = trackingStrategyForCarrier(carrier);

  const rows = targets.map((target) => ({
    tenant_id: params.tenantId,
    import_id: params.importId,
    carrier_code: carrier,
    strategy: target.strategy ?? strategy,
    query_type: target.queryType,
    query_value: target.queryValue,
    container_number: target.containerNumber,
    status: "pending",
    source: "scrape",
    raw: {
      expectedVessel: bl?.vessel ?? null,
      expectedVoyage: bl?.voyage ?? null,
    },
  }));

  const { error: upsertError } = await admin
    .from("tracking_shipments")
    .upsert(rows, {
      onConflict: "import_id,carrier_code,query_type,query_value",
      ignoreDuplicates: true,
    });

  if (upsertError) {
    throw new Error(`Falha ao criar rastreios: ${upsertError.message}`);
  }

  const { data: shipments, error: listError } = await admin
    .from("tracking_shipments")
    .select("id, carrier_code, strategy, next_check_at, query_type, query_value")
    .eq("tenant_id", params.tenantId)
    .eq("import_id", params.importId);

  if (listError) {
    throw new Error(`Falha ao listar rastreios: ${listError.message}`);
  }

  // O upsert ignora linhas existentes; sem reconciliar, uma importação antiga
  // continuaria com vários alvos consultáveis (fan-out). Garante a regra de
  // **uma consulta por importação**: só o alvo escolhido fica `http`/
  // `firecrawl`, o resto vira `link` (exibição/evento manual).
  const consultableTarget =
    targets.find((target) => target.strategy !== "link") ?? null;
  const consultableStrategy =
    consultableTarget && strategy !== "link" ? strategy : null;
  const downgradedIds: string[] = [];

  for (const row of shipments ?? []) {
    const matchesConsultable =
      consultableTarget !== null &&
      row.carrier_code === carrier &&
      row.query_type === consultableTarget.queryType &&
      row.query_value === consultableTarget.queryValue;

    if (matchesConsultable) {
      // Promove um alvo antigo que ainda estava `link` (ex.: armador corrigido
      // de CMA para Maersk). `manual` nunca muda.
      if (
        consultableStrategy &&
        row.strategy !== "manual" &&
        row.strategy !== consultableStrategy
      ) {
        const { error: promoteError } = await admin
          .from("tracking_shipments")
          .update({ strategy: consultableStrategy })
          .eq("id", row.id);

        if (promoteError) {
          throw new Error(
            `Falha ao atualizar rastreio: ${promoteError.message}`,
          );
        }
        row.strategy = consultableStrategy;
      }
      continue;
    }

    if (row.strategy === "http" || row.strategy === "firecrawl") {
      downgradedIds.push(row.id);
      row.strategy = "link";
    }
  }

  if (downgradedIds.length > 0) {
    const { error: downgradeError } = await admin
      .from("tracking_shipments")
      .update({ strategy: "link", next_check_at: null })
      .in("id", downgradedIds);

    if (downgradeError) {
      throw new Error(
        `Falha ao atualizar rastreios: ${downgradeError.message}`,
      );
    }

    // Job `queued` de um alvo rebaixado não deve ser consultado; `running`
    // termina sozinho e o guard de `link` no processamento o descarta.
    const { error: jobsError } = await admin
      .from("tracking_jobs")
      .update({ status: "done", last_error: "single_query_target" })
      .in("shipment_id", downgradedIds)
      .eq("status", "queued");

    if (jobsError) {
      throw new Error(
        `Falha ao encerrar jobs de rastreio: ${jobsError.message}`,
      );
    }
  }

  const shipmentIds = (shipments ?? []).map((row) => row.id);
  if (shipmentIds.length === 0) return { shipments: 0, queued: 0 };

  const { data: activeJobs, error: jobsError } = await admin
    .from("tracking_jobs")
    .select("shipment_id")
    .in("shipment_id", shipmentIds)
    .in("status", ["queued", "running"]);

  if (jobsError) {
    throw new Error(`Falha ao listar jobs de rastreio: ${jobsError.message}`);
  }

  const busy = new Set((activeJobs ?? []).map((row) => row.shipment_id));
  const jobRows = (shipments ?? [])
    .filter(
      (row) =>
        !busy.has(row.id) &&
        row.strategy !== "link" &&
        row.strategy !== "manual",
    )
    .map((row) => ({
      tenant_id: params.tenantId,
      shipment_id: row.id,
      strategy: row.strategy === "http" ? "http" : "firecrawl",
      status: "queued" as const,
      run_after: new Date().toISOString(),
    }));

  if (jobRows.length > 0) {
    const { error: insertError } = await admin
      .from("tracking_jobs")
      .insert(jobRows);
    if (insertError) {
      throw new Error(`Falha ao enfileirar rastreio: ${insertError.message}`);
    }
  }

  return { shipments: shipmentIds.length, queued: jobRows.length };
}

/**
 * Reenfileira os shipments vencidos (`next_check_at` nulo ou no passado) para o
 * cron. `claim_tracking_jobs` só reserva o que já está na fila: sem este passo,
 * a cadência semanal/diária pararia depois da primeira consulta.
 *
 * Não faz chamada externa — o orçamento de créditos é consumido apenas no
 * processamento (`processQueuedTrackingJobs`). Ignora `link`/`manual` (sem
 * portal automatizado), status terminais e quem já tem job `queued`/`running`.
 */
export async function enqueueDueTrackingShipments(
  params: { limit?: number; now?: Date } = {},
): Promise<{ queued: number }> {
  const admin = createSupabaseAdminClient();
  const now = params.now ?? new Date();
  const nowIso = now.toISOString();
  const limit = Math.max(
    Math.trunc(params.limit ?? DEFAULT_DUE_ENQUEUE_LIMIT),
    1,
  );

  const { data: shipments, error } = await admin
    .from("tracking_shipments")
    .select("id, tenant_id, strategy, next_check_at")
    .in("strategy", ["http", "firecrawl"])
    .in("status", NON_TERMINAL_STATUSES)
    .or(`next_check_at.is.null,next_check_at.lte.${nowIso}`)
    .order("next_check_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error) {
    throw new Error(`Falha ao listar rastreios vencidos: ${error.message}`);
  }

  if (!shipments || shipments.length === 0) return { queued: 0 };

  const shipmentIds = shipments.map((row) => row.id);
  const { data: activeJobs, error: jobsError } = await admin
    .from("tracking_jobs")
    .select("shipment_id")
    .in("shipment_id", shipmentIds)
    .in("status", ["queued", "running"]);

  if (jobsError) {
    throw new Error(`Falha ao listar jobs de rastreio: ${jobsError.message}`);
  }

  const busy = new Set((activeJobs ?? []).map((row) => row.shipment_id));
  const jobRows = shipments
    .filter((row) => !busy.has(row.id))
    .map((row) => ({
      tenant_id: row.tenant_id,
      shipment_id: row.id,
      strategy: row.strategy === "http" ? "http" : "firecrawl",
      status: "queued" as const,
      run_after: nowIso,
    }));

  if (jobRows.length === 0) return { queued: 0 };

  // Duas execuções simultâneas podem criar jobs duplicados (mesma janela do
  // `enqueueTrackingForImport`): o claim da fila é atômico e `processShipment`
  // usa lock otimista, então o segundo job não repete o scrape.
  const { error: insertError } = await admin
    .from("tracking_jobs")
    .insert(jobRows);

  if (insertError) {
    throw new Error(`Falha ao reenfileirar rastreio: ${insertError.message}`);
  }

  return { queued: jobRows.length };
}

type ScrapeOutcome =
  | {
      ok: true;
      snapshot: NormalizedTrackingSnapshot;
      credits: number;
      httpStatus: number | null;
    }
  | {
      ok: false;
      status: TrackingStatus;
      errorCode: string;
      errorMessage: string;
      credits: number;
    };

async function scrapeShipment(
  shipment: ShipmentRow,
): Promise<ScrapeOutcome> {
  if (!isFirecrawlConfigured()) {
    return {
      ok: false,
      status: "blocked",
      errorCode: "firecrawl_not_configured",
      errorMessage: "FIRECRAWL_API_KEY não configurada",
      credits: 0,
    };
  }

  const carrier = shipment.carrier_code as CarrierCode;
  const queryType = shipment.query_type as TrackingQueryType;
  const queryValue = shipment.query_value;

  // MSC expõe uma API interna gratuita; não usa Firecrawl.
  if (carrier === "msc") {
    const result = await fetchMscTracking({ queryType, queryValue });
    if (!result.ok) {
      const blocked =
        result.errorCode === "msc_session_error" ||
        /^msc_http_40[13]$/.test(result.errorCode);
      return {
        ok: false,
        status: blocked ? "blocked" : "error",
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        credits: 0,
      };
    }
    return {
      ok: true,
      snapshot: result.snapshot,
      credits: 0,
      httpStatus: result.httpStatus,
    };
  }

  // HMM também tem API interna (0 créditos).
  if (carrier === "hmm") {
    const result = await fetchHmmTracking({ queryType, queryValue });
    if (!result.ok) {
      const blocked =
        result.errorCode === "hmm_session_error" ||
        result.errorCode.startsWith("hmm_blocked_");
      return {
        ok: false,
        status: blocked ? "blocked" : "error",
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        credits: 0,
      };
    }
    return {
      ok: true,
      snapshot: result.snapshot,
      credits: 0,
      httpStatus: result.httpStatus,
    };
  }

  // ONE também expõe API interna (0 créditos).
  if (carrier === "one") {
    const result = await fetchOneTracking({ queryType, queryValue });
    if (!result.ok) {
      const blocked = /^one_http_40[13]$/.test(result.errorCode);
      return {
        ok: false,
        status: blocked ? "blocked" : "error",
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        credits: 0,
      };
    }
    return {
      ok: true,
      snapshot: result.snapshot,
      credits: 0,
      httpStatus: result.httpStatus,
    };
  }

  const url = buildCarrierScrapeUrl({
    carrier,
    queryType,
    queryValue,
  });

  if (!url) {
    return {
      ok: false,
      status: "blocked",
      errorCode: "carrier_unsupported",
      errorMessage: "Armador sem portal de rastreio suportado",
      credits: 0,
    };
  }

  const mode = trackingFirecrawlMode();
  const credits = estimateFirecrawlCredits(mode);
  const expectedVessel = readExpectedVessel(shipment);
  // 1 retry só na Maersk e só para `not_found` real do portal (`ok: true` com
  // página sem resultado). Divergência de navio é rollover/transbordo válido:
  // o snapshot é aceito com `vesselMismatch` e **não** repete a consulta.
  const attempts = carrier === "maersk" ? 2 : 1;
  let lastFailure: Extract<ScrapeOutcome, { ok: false }> | null = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const allowed = await consumeTrackingCredits({
      tenantId: shipment.tenant_id,
      credits,
    });
    if (!allowed) {
      return {
        ok: false,
        status: "blocked",
        errorCode: "budget_exhausted",
        errorMessage: "Orçamento mensal de rastreio esgotado",
        credits: 0,
      };
    }

    const result = await scrapeWithFirecrawl({
      url,
      mode,
      // A Maersk renderiza o resultado via SPA atrás do Akamai; a COSCO é uma
      // SPA que busca a partir da URL. Hapag usa formulário AEM.
      waitForMs:
        carrier === "maersk"
          ? 18_000
          : carrier === "cosco"
            ? 14_000
            : carrier === "hapag"
              ? 12_000
              : 8_000,
      proxy: carrier === "maersk" ? "stealth" : undefined,
      actions: buildCarrierActions({
        carrier,
        queryType,
        queryValue,
      }),
    });

    if (!result.ok) {
      lastFailure = {
        ok: false,
        status:
          result.errorCode === "firecrawl_rate_limited" ||
          result.errorCode === "firecrawl_no_credits" ||
          result.errorCode === "firecrawl_unauthorized"
            ? "blocked"
            : "error",
        errorCode: result.errorCode ?? "firecrawl_error",
        errorMessage: result.errorMessage ?? "Falha ao consultar o armador",
        credits,
      };
      continue;
    }

    if (result.statusCode !== null && result.statusCode >= 400) {
      lastFailure = {
        ok: false,
        status: "blocked",
        errorCode: `carrier_http_${result.statusCode}`,
        errorMessage: `Portal do armador respondeu ${result.statusCode}`,
        credits,
      };
      continue;
    }

    const snapshot = normalizeFirecrawlResult(
      result.json,
      shipment.container_number,
      { vessel: expectedVessel },
    );

    if (
      snapshot.notes &&
      /captcha|login|access denied|bloquead|maintenance|manuten[cç][aã]o/i.test(
        snapshot.notes,
      )
    ) {
      lastFailure = {
        ok: false,
        status: "blocked",
        errorCode: "carrier_blocked",
        errorMessage: snapshot.notes.slice(0, 300),
        credits,
      };
      continue;
    }

    // Maersk às vezes devolve placeholder (portal sem resultado) na primeira
    // consulta; o retry vale **só** para `not_found` real. Divergência de navio
    // (`snapshot.vesselMismatch`) é aceita e não chega aqui.
    if (
      carrier === "maersk" &&
      snapshot.status === "not_found" &&
      attempt < attempts - 1
    ) {
      lastFailure = {
        ok: false,
        status: "not_found",
        errorCode: "maersk_no_result",
        errorMessage: snapshot.notes ?? "Sem resultado no portal da Maersk",
        credits,
      };
      continue;
    }

    return { ok: true, snapshot, credits, httpStatus: result.statusCode };
  }

  return (
    lastFailure ?? {
      ok: false,
      status: "error",
      errorCode: "tracking_failed",
      errorMessage: "Falha ao consultar o armador",
      credits: 0,
    }
  );
}

function readExpectedVessel(shipment: ShipmentRow): string | null {
  const raw = shipment.raw;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = (raw as Record<string, unknown>).expectedVessel;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Converte o ETA do snapshot (ISO `YYYY-MM-DD`, já sem fuso) para o padrão do
 * formulário (DD/MM/AAAA). Não passa por `Date` de propósito: qualquer conversão
 * de fuso poderia deslocar o dia. Valor já em pt-BR é mantido; formato
 * desconhecido é descartado.
 */
function formatEtaBr(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(raw);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;

  return null;
}

/**
 * Preenche o campo `eta` do payload do BL (`extraction_results`) com a previsão
 * de chegada devolvida pelo armador. Roda sem sessão (cron/worker), então usa o
 * client admin e o `tenant_id` do shipment.
 *
 * Só preenche quando o campo está vazio: um ETA extraído do documento ou
 * digitado pelo usuário nunca é sobrescrito. Devolve `true` quando gravou.
 */
async function fillBlEtaFromTracking(params: {
  tenantId: string;
  importId: string;
  eta: string | null | undefined;
}): Promise<boolean> {
  const eta = formatEtaBr(params.eta);
  if (!eta) return false;

  const admin = createSupabaseAdminClient();

  const { data: documents, error: documentsError } = await admin
    .from("documents")
    .select("id")
    .eq("tenant_id", params.tenantId)
    .eq("import_id", params.importId)
    .eq("doc_type", "bill_of_lading");

  if (documentsError) {
    throw new Error(
      `Falha ao buscar documentos do BL: ${documentsError.message}`,
    );
  }

  const documentIds = (documents ?? []).map((row) => row.id);
  if (documentIds.length === 0) return false;

  const { data: extraction, error: extractionError } = await admin
    .from("extraction_results")
    .select("id, payload")
    .eq("tenant_id", params.tenantId)
    .in("document_id", documentIds)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (extractionError) {
    throw new Error(
      `Falha ao buscar extração do BL: ${extractionError.message}`,
    );
  }
  if (!extraction) return false;

  const payload = extraction.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }

  const record = payload as Record<string, unknown>;
  const current = record.eta;
  if (current != null && String(current).trim().length > 0) return false;

  const { error: updateError } = await admin
    .from("extraction_results")
    .update({ payload: { ...record, eta } as unknown as Json })
    .eq("id", extraction.id)
    .eq("tenant_id", params.tenantId);

  if (updateError) {
    throw new Error(`Falha ao salvar ETA do BL: ${updateError.message}`);
  }

  await syncImportEta({ tenantId: params.tenantId, importId: params.importId });

  return true;
}

/** Eventos que marcam previsão (não chegada concluída). */
const PLANNED_EVENT_RE =
  /estimated|expected|planned|scheduled|previst[oa]|programad[oa]|previs[aã]o/i;

/** Eventos que marcam chegada/descarga de fato. */
const ARRIVAL_EVENT_RE =
  /arriv|discharg|unload|descarreg|descarga|chegada|atracad|at\s*berth/i;

/** Porto de transbordo (T/S): chegada/descarga ali não é a chegada final. */
const TRANSSHIPMENT_PLACE_RE = /\bT\/S\b|\bTSS\b|transship|transbordo|transb/i;

type TrackingMilestoneEvent = Pick<
  NormalizedTrackingSnapshot["events"][number],
  "eventAt" | "status" | "description" | "location"
>;

/** Data pura `YYYY-MM-DD`; descarta horário/fuso e formatos desconhecidos. */
function isoDay(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return match?.[1] ?? null;
}

function isArrivalEvent(event: TrackingMilestoneEvent): boolean {
  const text = `${event.status ?? ""} ${event.description ?? ""}`;
  if (PLANNED_EVENT_RE.test(text)) return false;
  if (!ARRIVAL_EVENT_RE.test(text)) return false;
  const place = `${event.description ?? ""} ${event.location ?? ""}`;
  return !TRANSSHIPMENT_PLACE_RE.test(place);
}

/**
 * Marcos usados no cálculo de atraso: o **primeiro ETA** que o armador informou
 * (`eta_original`) e a **chegada real** (`ata`, data do marco de chegada/descarga
 * mais recente já concluído — o último porto visitado).
 *
 * Nunca sobrescreve um marco já gravado e ignora eventos futuros (previsão não
 * é chegada) e de transbordo (T/S não é o destino). Devolve apenas os campos
 * que devem ser atualizados.
 */
function trackingMilestonePatch(params: {
  etaOriginal: string | null | undefined;
  ata: string | null | undefined;
  eta: string | null | undefined;
  events: ReadonlyArray<TrackingMilestoneEvent>;
  now?: Date;
}): { eta_original?: string; ata?: string } {
  const patch: { eta_original?: string; ata?: string } = {};

  if (!params.etaOriginal?.trim()) {
    const eta = isoDay(params.eta);
    if (eta) patch.eta_original = eta;
  }

  if (!params.ata?.trim()) {
    const now = (params.now ?? new Date()).getTime();
    const arrivals = params.events
      .filter(isArrivalEvent)
      .map((event) => ({
        day: isoDay(event.eventAt),
        time: Date.parse(event.eventAt),
      }))
      .filter(
        (event): event is { day: string; time: number } =>
          Boolean(event.day) && Number.isFinite(event.time) && event.time <= now,
      )
      .sort((a, b) => b.time - a.time);

    const arrival = arrivals[0];
    if (arrival) patch.ata = arrival.day;
  }

  return patch;
}

/**
 * Grava os marcos do embarque em uma atualização própria. Falha aqui nunca
 * derruba o rastreio: o snapshot principal segue normalmente (mesmo padrão do
 * preenchimento de ETA do BL).
 */
async function persistTrackingMilestones(params: {
  shipment: ShipmentRow;
  snapshot: NormalizedTrackingSnapshot;
  now?: Date;
}): Promise<void> {
  const patch = trackingMilestonePatch({
    etaOriginal: params.shipment.eta_original,
    ata: params.shipment.ata,
    eta: params.snapshot.eta,
    events: params.snapshot.events,
    now: params.now,
  });

  if (Object.keys(patch).length === 0) return;

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("tracking_shipments")
    .update(patch)
    .eq("id", params.shipment.id)
    .eq("tenant_id", params.shipment.tenant_id);

  if (error) {
    throw new Error(`Falha ao salvar marcos do embarque: ${error.message}`);
  }
}

async function persistSnapshot(params: {
  shipment: ShipmentRow;
  snapshot: NormalizedTrackingSnapshot;
  httpStatus: number | null;
  credits: number;
  /**
   * `true` só para o alvo realmente consultado (BL ou o primeiro container
   * quando o BL é `link`): é o ETA do embarque. Containers `link` recebem o
   * snapshot por fan-out e não podem preencher o formulário do BL.
   */
  fillBlEta: boolean;
}): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { shipment } = params;
  const latest = params.snapshot.events[0];

  try {
    await persistTrackingMilestones({
      shipment,
      snapshot: params.snapshot,
    });
  } catch (error) {
    console.error(
      "[tracking] falha ao gravar marcos do embarque:",
      error instanceof Error ? error.message : error,
    );
  }

  const { error: updateError } = await admin
    .from("tracking_shipments")
    .update({
      status: params.snapshot.status,
      vessel: params.snapshot.vessel,
      voyage: params.snapshot.voyage,
      eta: params.snapshot.eta,
      last_event_at: latest?.eventAt ?? shipment.last_event_at,
      last_event_location: latest?.location ?? shipment.last_event_location,
      last_event_description:
        latest?.description ?? shipment.last_event_description,
      fetched_at: new Date().toISOString(),
      next_check_at: nextCheckAtFor({
        status: params.snapshot.status,
        eta: params.snapshot.eta,
        attempts: shipment.attempts,
      }),
      attempts: 0,
      locked_until: null,
      last_http_status: params.httpStatus,
      error_code: null,
      error_message: null,
      raw: {
        ...(shipment.raw &&
        typeof shipment.raw === "object" &&
        !Array.isArray(shipment.raw)
          ? (shipment.raw as Record<string, unknown>)
          : {}),
        // Inclui `vesselMismatch` quando o navio do portal difere do BL.
        snapshot: params.snapshot,
      } as unknown as Database["public"]["Tables"]["tracking_shipments"]["Row"]["raw"],
    })
    .eq("id", shipment.id);

  if (updateError) {
    throw new Error(`Falha ao salvar rastreio: ${updateError.message}`);
  }

  // O ETA do alvo consultado alimenta o campo `eta` do payload do BL (o mesmo
  // que o formulário da importação exibe/edita). Na CMA/MSC o alvo é um
  // container, mas representa o embarque inteiro. Containers `link` (fan-out)
  // não preenchem. Falha aqui nunca derruba o rastreio.
  if (params.fillBlEta) {
    try {
      await fillBlEtaFromTracking({
        tenantId: shipment.tenant_id,
        importId: shipment.import_id,
        eta: params.snapshot.eta,
      });
    } catch (error) {
      console.error(
        "[tracking] falha ao preencher ETA do BL:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  if (params.snapshot.events.length === 0) return;

  const eventRows = params.snapshot.events.map((event) => ({
    tenant_id: shipment.tenant_id,
    shipment_id: shipment.id,
    event_at: event.eventAt,
    status: event.status,
    location: event.location,
    description: event.description,
    vessel: event.vessel,
    voyage: event.voyage,
    container_number: event.containerNumber,
    source: "scrape" as const,
    fingerprint: event.fingerprint,
  }));

  const { error: insertError } = await admin
    .from("tracking_events")
    .upsert(eventRows, {
      onConflict: "shipment_id,fingerprint",
      ignoreDuplicates: true,
    });

  if (insertError) {
    throw new Error(`Falha ao salvar eventos de rastreio: ${insertError.message}`);
  }
}

/**
 * Copia o resultado do BL para as linhas de container da mesma importação.
 * Cada container vira `strategy = "link"`: a UI mostra os eventos, mas o cron
 * não gasta crédito consultando container por container.
 */
async function fanOutBlSnapshot(params: {
  shipment: ShipmentRow;
  snapshot: NormalizedTrackingSnapshot;
  httpStatus: number | null;
}): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data: containers, error } = await admin
    .from("tracking_shipments")
    .select("*")
    .eq("tenant_id", params.shipment.tenant_id)
    .eq("import_id", params.shipment.import_id)
    .eq("query_type", "container");

  if (error || !containers || containers.length === 0) return;

  const byNumber = new Map(
    (containers as ShipmentRow[]).map((row) => [row.query_value, row]),
  );

  for (const number of params.snapshot.containers) {
    const row = byNumber.get(number);
    if (!row) continue;

    const events = params.snapshot.events.filter(
      (event) => event.containerNumber === number,
    );
    if (events.length === 0) continue;

    const latest = events[0];
    let status = latest?.status ?? params.snapshot.status;
    // Chegada/descarga com data futura é previsão, não evento concluído.
    if (
      latest &&
      (status === "arrived" || status === "discharged") &&
      Date.parse(latest.eventAt) > Date.now()
    ) {
      status = "in_transit";
    }

    await persistSnapshot({
      shipment: row,
      snapshot: {
        ...params.snapshot,
        status,
        events,
      },
      httpStatus: params.httpStatus,
      credits: 0,
      // Container `link`: o ETA do embarque já veio do alvo consultado.
      fillBlEta: false,
    });

    await admin
      .from("tracking_shipments")
      .update({
        strategy: "link",
        next_check_at: null,
        last_http_status: params.httpStatus,
      })
      .eq("id", row.id);
  }

  const ids = (containers as ShipmentRow[]).map((row) => row.id);
  if (ids.length > 0) {
    await admin
      .from("tracking_jobs")
      .update({ status: "done", last_error: "covered_by_bl" })
      .in("shipment_id", ids)
      .eq("status", "queued");
  }
}

async function markShipmentFailure(params: {
  shipment: ShipmentRow;
  status: TrackingStatus;
  errorCode: string;
  errorMessage: string;
  credits: number;
}): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin
    .from("tracking_shipments")
    .update({
      status: params.status,
      attempts: params.shipment.attempts + 1,
      fetched_at: new Date().toISOString(),
      locked_until: null,
      next_check_at: nextCheckAtFor({
        status: params.status,
        eta: params.shipment.eta,
        attempts: params.shipment.attempts + 1,
      }),
      error_code: params.errorCode,
      error_message: params.errorMessage.slice(0, 500),
    })
    .eq("id", params.shipment.id);
}

/**
 * Fallback aprovado: o BL é a consulta da importação, mas alguns armadores não
 * conhecem o BL de casa (ex.: HMM com `MSIRYOE261000021`) e respondem
 * `not_found`. Nesse caso — e só nele — o primeiro container válido assume a
 * consulta por **uma única tentativa** e passa a ser o alvo consultável: o BL
 * vira `link` para não gastar crédito duas vezes por ciclo.
 *
 * Nunca dispara a partir de um container (sem recursão) e não roda quando a
 * importação já tem um container consultável (`http`/`firecrawl`).
 */
async function fallbackToFirstContainer(shipment: ShipmentRow): Promise<void> {
  if (shipment.query_type !== "bl") return;

  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from("tracking_shipments")
    .select("*")
    .eq("tenant_id", shipment.tenant_id)
    .eq("import_id", shipment.import_id)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Falha ao listar rastreios do fallback: ${error.message}`);
  }

  const siblings = (data ?? []) as ShipmentRow[];
  const hasConsultableContainer = siblings.some(
    (row) =>
      row.query_type === "container" &&
      (row.strategy === "http" || row.strategy === "firecrawl"),
  );
  if (hasConsultableContainer) return;

  const container = siblings.find(
    (row) => row.query_type === "container" && row.strategy === "link",
  );
  if (!container) return;

  const carrier = container.carrier_code as CarrierCode;
  // Provider sem consulta por container (ou portal em `link`): não promove —
  // BL e containers ficam `link` e o rastreio é manual pelo portal.
  if (!carrierSupportsContainer(carrier)) return;

  const strategy = trackingStrategyForCarrier(carrier);
  if (strategy === "link") return;

  const { data: promoted, error: promoteError } = await admin
    .from("tracking_shipments")
    .update({ strategy, next_check_at: null })
    .eq("id", container.id)
    .eq("tenant_id", shipment.tenant_id)
    .eq("strategy", "link")
    .select("*")
    .maybeSingle();

  if (promoteError) {
    throw new Error(
      `Falha ao promover container do fallback: ${promoteError.message}`,
    );
  }
  if (!promoted) return;

  // Mantém **uma consulta por importação**: o BL que respondeu `not_found`
  // passa a `link` e só o container é consultado daqui em diante.
  const demotedIds = siblings
    .filter(
      (row) =>
        row.id !== container.id &&
        (row.strategy === "http" || row.strategy === "firecrawl"),
    )
    .map((row) => row.id);

  if (demotedIds.length > 0) {
    const { error: demoteError } = await admin
      .from("tracking_shipments")
      .update({ strategy: "link", next_check_at: null })
      .in("id", demotedIds)
      .eq("tenant_id", shipment.tenant_id);

    if (demoteError) {
      throw new Error(
        `Falha ao rebaixar BL do fallback: ${demoteError.message}`,
      );
    }

    // Job `queued` de um alvo rebaixado (duplicata de enqueue concorrente) não
    // deve ser consultado; o mesmo desfecho de `enqueueTrackingForImport`.
    const { error: jobsError } = await admin
      .from("tracking_jobs")
      .update({ status: "done", last_error: "single_query_target" })
      .in("shipment_id", demotedIds)
      .eq("status", "queued");

    if (jobsError) {
      throw new Error(
        `Falha ao encerrar jobs do fallback: ${jobsError.message}`,
      );
    }
  }

  // Consulta única do container promovido; `fillBlEta` já é o padrão de
  // `processShipment`, então o ETA dele preenche o formulário do BL.
  await processShipment(promoted as ShipmentRow);
}

async function processShipment(shipment: ShipmentRow): Promise<boolean> {
  const admin = createSupabaseAdminClient();

  // Lock otimista: cron e botão manual podem disputar o mesmo shipment.
  const now = new Date().toISOString();
  const { data: claimed } = await admin
    .from("tracking_shipments")
    .update({
      locked_until: new Date(Date.now() + 10 * 60_000).toISOString(),
    })
    .eq("id", shipment.id)
    .eq("tenant_id", shipment.tenant_id)
    .or(`locked_until.is.null,locked_until.lt.${now}`)
    .select("id")
    .maybeSingle();

  if (!claimed) return true;

  const outcome = await scrapeShipment(shipment);
  if (!outcome.ok) {
    await markShipmentFailure({
      shipment,
      status: outcome.status,
      errorCode: outcome.errorCode,
      errorMessage: outcome.errorMessage,
      credits: outcome.credits,
    });
    return false;
  }

  await persistSnapshot({
    shipment,
    snapshot: outcome.snapshot,
    httpStatus: outcome.httpStatus,
    credits: outcome.credits,
    // Único alvo consultado da importação (BL ou primeiro container): o ETA
    // dele é o ETA do embarque no formulário do BL.
    fillBlEta: true,
  });

  // BLs de alguns armadores (Evergreen) já retornam todos os containers:
  // replica o resultado para as linhas de container e evita scrapes extras.
  if (shipment.query_type === "bl" && outcome.snapshot.containers.length > 0) {
    await fanOutBlSnapshot({
      shipment,
      snapshot: outcome.snapshot,
      httpStatus: outcome.httpStatus,
    });
  }

  // Fallback aprovado: o BL existe no documento, mas o armador não o conhece
  // (BL de casa). O primeiro container assume a consulta por uma única
  // tentativa. Falha aqui nunca derruba o BL, que já foi persistido.
  if (
    shipment.query_type === "bl" &&
    outcome.snapshot.status === "not_found"
  ) {
    try {
      await fallbackToFirstContainer(shipment);
    } catch (error) {
      console.error(
        "[tracking] fallback de container falhou:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  return true;
}

/**
 * Ordena os alvos de uma importação: o BL primeiro, containers depois (o BL
 * traz o ETA e, quando devolve os containers, cobre as linhas de container).
 */
export function prioritizeBlShipments<T extends { query_type: string }>(
  shipments: T[],
): T[] {
  return [...shipments].sort(
    (a, b) => Number(b.query_type === "bl") - Number(a.query_type === "bl"),
  );
}

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

/** Tentativas máximas de um job antes de virar `failed` (igual ao RPC). */
const TRACKING_JOB_MAX_ATTEMPTS = 3;

/**
 * Reserva jobs para processamento. Sem `importId`, usa o claim atômico da fila
 * (cron). Com `importId` (primeira consulta disparada pela análise), restringe
 * o lote à importação e prioriza o alvo `bl` — a fila global pode ter jobs
 * antigos, que ficariam na frente do BL recém-extraído.
 *
 * Nos dois caminhos um job `running` com lock vencido volta a ser reivindicável
 * (worker morto/timeout da function); sem isso o shipment ficaria "busy" para
 * sempre. O `attempts` é incrementado pelo RPC; aqui as tentativas são apenas
 * conferidas, e quem estourou o teto vira `failed` (`stale_timeout`).
 */
async function claimTrackingJobs(params: {
  admin: AdminClient;
  worker: string;
  limit: number;
  importId?: string;
}): Promise<JobRow[]> {
  if (!params.importId) {
    const { data, error } = await params.admin.rpc("claim_tracking_jobs", {
      p_worker: params.worker,
      p_limit: params.limit,
      p_strategy: null,
    });

    if (error) {
      throw new Error(`Falha ao reservar jobs de rastreio: ${error.message}`);
    }

    return (data ?? []) as JobRow[];
  }

  const { data: shipments, error: shipmentsError } = await params.admin
    .from("tracking_shipments")
    .select("id, query_type")
    .eq("import_id", params.importId)
    .in("strategy", ["http", "firecrawl"]);

  if (shipmentsError) {
    throw new Error(`Falha ao listar rastreios: ${shipmentsError.message}`);
  }

  const now = new Date().toISOString();
  const lockedUntil = new Date(Date.now() + 10 * 60_000).toISOString();
  const claimedJobs: JobRow[] = [];

  // UPDATE condicional é atômico: um segundo worker que perder a corrida
  // reavalia o filtro de status e não reserva o mesmo job.
  for (const shipment of prioritizeBlShipments(shipments ?? [])) {
    if (claimedJobs.length >= params.limit) break;

    // Worker morto com tentativas esgotadas: `failed` é terminal e libera o
    // shipment (mesmo desfecho do `claim_tracking_jobs` usado pelo cron).
    const { error: staleError } = await params.admin
      .from("tracking_jobs")
      .update({
        status: "failed",
        last_error: "stale_timeout",
        locked_until: null,
        locked_by: null,
      })
      .eq("shipment_id", shipment.id)
      .eq("status", "running")
      .lt("locked_until", now)
      .gte("attempts", TRACKING_JOB_MAX_ATTEMPTS);

    if (staleError) {
      throw new Error(
        `Falha ao encerrar jobs de rastreio: ${staleError.message}`,
      );
    }

    const { data: claimed, error } = await params.admin
      .from("tracking_jobs")
      .update({
        status: "running",
        locked_until: lockedUntil,
        locked_by: params.worker,
      })
      .eq("shipment_id", shipment.id)
      .eq("status", "queued")
      .lte("run_after", now)
      .select("*");

    if (error) {
      throw new Error(`Falha ao reservar job de rastreio: ${error.message}`);
    }

    if (claimed && claimed.length > 0) {
      claimedJobs.push(...(claimed as JobRow[]));
      continue;
    }

    // Job `running` órfão (function morta no meio do scrape): o lock vencido e
    // as tentativas restantes permitem reivindicar de novo. O `locked_until`
    // futuro do job recém-reservado acima o mantém fora deste filtro.
    const { data: stale, error: staleClaimError } = await params.admin
      .from("tracking_jobs")
      .update({
        status: "running",
        locked_until: lockedUntil,
        locked_by: params.worker,
      })
      .eq("shipment_id", shipment.id)
      .eq("status", "running")
      .lt("locked_until", now)
      .lt("attempts", TRACKING_JOB_MAX_ATTEMPTS)
      .select("*");

    if (staleClaimError) {
      throw new Error(
        `Falha ao reservar job de rastreio: ${staleClaimError.message}`,
      );
    }

    if (stale && stale.length > 0) {
      claimedJobs.push(...(stale as JobRow[]));
    }
  }

  return claimedJobs;
}

/** Drena até `limit` jobs enfileirados (cron e primeira consulta da análise). */
export async function processQueuedTrackingJobs(params: {
  limit?: number;
  worker?: string;
  /** Restringe o lote a esta importação, priorizando o alvo `bl`. */
  importId?: string;
}): Promise<{ processed: number; failed: number }> {
  const admin = createSupabaseAdminClient();
  const jobs = await claimTrackingJobs({
    admin,
    worker: params.worker ?? "cron",
    limit: params.limit ?? 3,
    importId: params.importId,
  });

  let processed = 0;
  let failed = 0;

  for (const job of jobs) {
    const { data: shipment } = await admin
      .from("tracking_shipments")
      .select("*")
      .eq("id", job.shipment_id)
      .eq("tenant_id", job.tenant_id)
      .maybeSingle();

    if (!shipment) {
      await admin
        .from("tracking_jobs")
        .update({ status: "failed", last_error: "shipment_not_found" })
        .eq("id", job.id);
      failed += 1;
      continue;
    }

    if (shipment.strategy === "link") {
      await admin
        .from("tracking_jobs")
        .update({ status: "done", last_error: "covered_by_bl" })
        .eq("id", job.id);
      processed += 1;
      continue;
    }

    try {
      const ok = await processShipment(shipment);
      await admin
        .from("tracking_jobs")
        .update({
          status: ok ? "done" : "failed",
          last_error: ok ? null : "scrape_failed",
        })
        .eq("id", job.id);
      if (ok) processed += 1;
      else failed += 1;
    } catch (error) {
      failed += 1;
      await admin
        .from("tracking_jobs")
        .update({
          status: "failed",
          last_error:
            error instanceof Error ? error.message.slice(0, 500) : String(error),
        })
        .eq("id", job.id);
    }
  }

  return { processed, failed };
}

/**
 * Enfileira e processa imediatamente (botão "Atualizar").
 *
 * A importação tem **um** alvo consultável, então o refresh consome exatamente
 * um job da fila (`processQueuedTrackingJobs` com `importId` e `limit: 1`):
 * o claim marca `running` → `done`/`failed` e não sobra job `queued` órfão.
 * `force` ignora `next_check_at` (o enqueue sempre cria o job do alvo
 * consultável, mesmo fora da cadência); sem `force`, só age quando há alvo
 * vencido — e aí nem enfileira, para não deixar job esperando o cron.
 *
 * Antes de qualquer enfileiramento, aplica o **cache curto** do botão
 * (`TRACKING_REFRESH_COOLDOWN_MINUTES`): se o alvo consultável já foi buscado
 * há menos de N minutos — inclusive quando a última busca falhou — devolve
 * `skipped: "cooldown"` sem gastar crédito. `force` não fura o cooldown; `0`
 * desativa. Cron e a primeira consulta da análise não usam este caminho.
 */
export async function refreshTrackingForImport(params: {
  tenantId: string;
  importId: string;
  force?: boolean;
}): Promise<{
  processed: number;
  failed: number;
  skipped?: "cooldown";
  retryAfterSeconds?: number;
}> {
  const admin = createSupabaseAdminClient();
  const { data: shipments, error } = await admin
    .from("tracking_shipments")
    .select("id, strategy, next_check_at, fetched_at")
    .eq("tenant_id", params.tenantId)
    .eq("import_id", params.importId)
    .in("strategy", ["http", "firecrawl"]);

  if (error) {
    throw new Error(`Falha ao carregar rastreios: ${error.message}`);
  }

  const current = shipments ?? [];

  const cooldownMinutes = trackingRefreshCooldownMinutes();
  if (cooldownMinutes > 0) {
    // Alvos `link`/`manual` não entram na query: não houve consulta paga.
    const lastFetchedAt = current.reduce((latest, row) => {
      if (!row.fetched_at) return latest;
      const fetchedAt = Date.parse(row.fetched_at);
      return Number.isFinite(fetchedAt) && fetchedAt > latest
        ? fetchedAt
        : latest;
    }, Number.NEGATIVE_INFINITY);

    if (Number.isFinite(lastFetchedAt)) {
      const retryAfterMs =
        lastFetchedAt + cooldownMinutes * 60_000 - Date.now();
      if (retryAfterMs > 0) {
        return {
          processed: 0,
          failed: 0,
          skipped: "cooldown",
          // Arredonda para cima: 1s já basta para o botão voltar a valer.
          retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
        };
      }
    }
  }

  const due = current.filter(
    (row) =>
      params.force ||
      !row.next_check_at ||
      new Date(row.next_check_at).getTime() <= Date.now(),
  );

  if (!params.force && current.length > 0 && due.length === 0) {
    return { processed: 0, failed: 0 };
  }

  await enqueueTrackingForImport({
    tenantId: params.tenantId,
    importId: params.importId,
  });

  return processQueuedTrackingJobs({
    importId: params.importId,
    limit: 1,
    worker: "refresh",
  });
}

type PrimaryShipmentCandidate = {
  strategy: string;
  lastEventAt: string | null;
};

/**
 * Ordem do shipment principal: alvo consultável antes de `link` (sem consulta)
 * e, dentro do grupo, o último evento mais recente. Empate preserva a ordem
 * recebida (a query usa `created_at asc`).
 */
function comparePrimaryShipment(
  a: PrimaryShipmentCandidate,
  b: PrimaryShipmentCandidate,
): number {
  const aLink = a.strategy === "link" ? 1 : 0;
  const bLink = b.strategy === "link" ? 1 : 0;
  if (aLink !== bLink) return aLink - bLink;
  const aTime = a.lastEventAt ? Date.parse(a.lastEventAt) : 0;
  const bTime = b.lastEventAt ? Date.parse(b.lastEventAt) : 0;
  return bTime - aTime;
}

/**
 * Shipment principal da importação (alvo do botão "Rastrear"), lendo só
 * o necessário para a ordenação — sem eventos, timeline ou créditos.
 */
export async function getPrimaryTrackingShipmentId(params: {
  tenantId: string;
  importId: string;
}): Promise<string | null> {
  const supabase = await getReadClient();

  const { data, error } = await supabase
    .from("tracking_shipments")
    .select("id, strategy, last_event_at")
    .eq("tenant_id", params.tenantId)
    .eq("import_id", params.importId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Falha ao carregar rastreios: ${error.message}`);
  }

  const candidates = (data ?? []).map((row) => ({
    id: row.id,
    strategy: row.strategy,
    lastEventAt: row.last_event_at,
  }));

  return candidates.sort(comparePrimaryShipment)[0]?.id ?? null;
}

/** Leitura completa do rastreio da importação para as rotas da API (RLS). */
export async function getTrackingForImport(
  tenantId: string,
  importId: string,
): Promise<ImportTracking> {
  const supabase = await getReadClient();

  const { data: shipments, error: shipmentsError } = await supabase
    .from("tracking_shipments")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("import_id", importId)
    .order("created_at", { ascending: true });

  if (shipmentsError) {
    throw new Error(
      `Falha ao carregar rastreios: ${shipmentsError.message}`,
    );
  }

  const shipmentIds = (shipments ?? []).map((row) => row.id);
  let events: EventRow[] = [];
  if (shipmentIds.length > 0) {
    const { data: eventRows, error: eventsError } = await supabase
      .from("tracking_events")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("shipment_id", shipmentIds)
      .order("event_at", { ascending: false })
      .limit(300);

    if (eventsError) {
      throw new Error(`Falha ao carregar eventos: ${eventsError.message}`);
    }
    events = (eventRows ?? []) as EventRow[];
  }

  const creditsUsed = await getTrackingCreditsUsed(tenantId);

  const mapped = (shipments ?? []).map((row) =>
    mapShipment(row as ShipmentRow),
  );
  // Alvos "link" (sem consulta) ficam por último; quem tem evento recente
  // vira o shipment principal. Mesma ordenação de `getPrimaryTrackingShipmentId`.
  mapped.sort(comparePrimaryShipment);

  return {
    shipments: mapped,
    events: events.map(mapEvent),
    creditsUsedThisMonth: creditsUsed,
    creditBudget: trackingMonthlyCreditBudget(),
  };
}

function fingerprint(parts: Array<string | null>): string {
  return createHash("sha256")
    .update(parts.map((part) => part ?? "").join("|"))
    .digest("hex")
    .slice(0, 40);
}

export type ManualTrackingEventInput = {
  eventAt: string;
  description: string;
  location?: string | null;
  status?: string | null;
  containerNumber?: string | null;
};

/** Evento lançado manualmente pelo usuário (fallback do scraping). */
export async function addManualTrackingEvent(params: {
  tenantId: string;
  importId: string;
  userId: string | null;
  event: ManualTrackingEventInput;
}): Promise<void> {
  const eventAt =
    parseTrackingDate(params.event.eventAt) ??
    (() => {
      throw new Error("Data do evento inválida");
    })();

  const description = params.event.description.trim();
  if (description.length < 2) {
    throw new Error("Descrição do evento é obrigatória");
  }

  const admin = createSupabaseAdminClient();
  const { data: shipments, error } = await admin
    .from("tracking_shipments")
    .select("*")
    .eq("tenant_id", params.tenantId)
    .eq("import_id", params.importId)
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    throw new Error(`Falha ao carregar rastreio: ${error.message}`);
  }

  let shipment = shipments?.[0] as ShipmentRow | undefined;

  if (!shipment) {
    const detail = await getImportDetail(params.tenantId, params.importId);
    const carrier = detectCarrier(detail.bl?.carrier);
    const queryValue =
      normalizeBlNumber(detail.bl_number) ??
      normalizeBlNumber(detail.bl?.number ?? null);
    if (!queryValue) {
      throw new Error("Importação sem BL: informe o número do BL antes do rastreio manual");
    }

    const { data: created, error: createError } = await admin
      .from("tracking_shipments")
      .insert({
        tenant_id: params.tenantId,
        import_id: params.importId,
        carrier_code: carrier,
        strategy: "manual",
        query_type: "bl",
        query_value: queryValue,
        status: "pending",
        source: "manual",
      })
      .select("*")
      .single();

    if (createError || !created) {
      throw new Error(
        `Falha ao criar rastreio manual: ${createError?.message ?? "desconhecido"}`,
      );
    }
    shipment = created as ShipmentRow;
  }

  const containerNumber =
    normalizeTrackingNumber(params.event.containerNumber) ??
    shipment.container_number;

  const status = inferTrackingStatus(params.event.status) ??
    inferTrackingStatus(description) ??
    "in_transit";

  const { error: insertError } = await admin.from("tracking_events").insert({
    tenant_id: params.tenantId,
    shipment_id: shipment.id,
    event_at: eventAt,
    status: params.event.status?.trim() || status,
    location: params.event.location?.trim() || null,
    description,
    container_number: containerNumber,
    source: "manual",
    fingerprint: fingerprint([containerNumber, eventAt, description.toLowerCase()]),
    created_by: params.userId,
  });

  if (insertError && insertError.code !== "23505") {
    throw new Error(`Falha ao salvar evento: ${insertError.message}`);
  }

  await admin
    .from("tracking_shipments")
    .update({
      source: "manual",
      last_event_at: eventAt,
      last_event_location: params.event.location?.trim() || null,
      last_event_description: description,
      fetched_at: new Date().toISOString(),
    })
    .eq("id", shipment.id)
    .eq("tenant_id", params.tenantId);
}
