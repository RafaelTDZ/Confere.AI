import "server-only";

import { CARRIERS, type CarrierCode } from "@/lib/tracking/carriers";

function readPositiveInt(value: string | undefined, fallback: number): number {
  const raw = value?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/** Teto mensal de créditos Firecrawl por tenant. 0 = sem teto. */
export function trackingMonthlyCreditBudget(): number {
  const raw = process.env.TRACKING_FIRECRAWL_MONTHLY_CREDITS?.trim();
  if (raw === "0") return 0;
  return readPositiveInt(raw, 3000);
}

/** Teto global (todos os tenants) por mês. 0 = sem teto. */
export function trackingGlobalCreditBudget(): number {
  const raw = process.env.TRACKING_FIRECRAWL_GLOBAL_CREDITS?.trim();
  if (raw === "0") return 0;
  return readPositiveInt(raw, 9000);
}

/**
 * Extração do Firecrawl: v1 usa sempre `json` (5 créditos/página), porque os
 * portais dos armadores são SPAs e não têm parser markdown dedicado ainda.
 */
export function trackingFirecrawlMode(): "json" {
  return "json";
}

/** Estratégia por armador, sobrescrita por TRACKING_CARRIER_STRATEGY. */
export function trackingStrategyForCarrier(
  carrier: CarrierCode,
): "http" | "firecrawl" | "link" {
  const raw = process.env.TRACKING_CARRIER_STRATEGY?.trim();
  if (raw) {
    for (const entry of raw.split(",")) {
      const [code, strategy] = entry.split("=").map((part) => part.trim());
      if (!code || !strategy) continue;
      if (code.toLowerCase() === carrier) {
        return strategy.toLowerCase() === "http" ? "http" : "firecrawl";
      }
    }
  }
  return CARRIERS[carrier]?.strategy ?? "firecrawl";
}

/** Quantos containers consultar quando o BL não retorna dados. */
export function trackingContainerFallbackLimit(): number {
  return readPositiveInt(
    process.env.TRACKING_CONTAINER_FALLBACK_LIMIT,
    3,
  );
}

/**
 * Intervalo de atualização quando falta pouco para o ETA (≤ 7 dias, ms).
 * Padrão: 1 dia — a chegada se aproxima, então a consulta é diária.
 */
export function trackingInTransitIntervalMs(): number {
  return readPositiveInt(
    process.env.TRACKING_IN_TRANSIT_INTERVAL_MINUTES,
    1440,
  ) * 60_000;
}

/**
 * Intervalo quando o ETA está longe (> 7 dias) ou ainda desconhecido (ms).
 * Padrão: 7 dias — o ciclo semanal basta longe do destino.
 */
export function trackingFarEtaIntervalMs(): number {
  return readPositiveInt(
    process.env.TRACKING_FAR_ETA_INTERVAL_MINUTES,
    10080,
  ) * 60_000;
}

/**
 * Cache curto do botão "Atualizar" (minutos): uma consulta recente ao armador
 * não é repetida, mesmo com `force` — cada scrape custa 5 créditos. Vale
 * também para a última consulta que falhou (`not_found`/`error`). `0` desativa;
 * cron e a primeira consulta da análise não passam por este caminho.
 */
export function trackingRefreshCooldownMinutes(): number {
  const raw = process.env.TRACKING_REFRESH_COOLDOWN_MINUTES?.trim();
  if (raw === "0") return 0;
  return readPositiveInt(raw, 30);
}
