import "server-only";

import { TRACKING_JSON_PROMPT, TRACKING_JSON_SCHEMA } from "@/lib/tracking/tracking-schema";

export type FirecrawlScrapeInput = {
  url: string;
  /** Extração estruturada (5 créditos) ou apenas markdown (1 crédito). */
  mode: "json" | "markdown";
  actions?: Array<Record<string, unknown>>;
  waitForMs?: number;
  timeoutMs?: number;
  /** "stealth" é necessário no Akamai da Maersk. */
  proxy?: "stealth" | "enhanced" | "auto";
};

export type FirecrawlScrapeResult = {
  ok: boolean;
  mode: "json" | "markdown";
  json: unknown;
  markdown: string | null;
  statusCode: number | null;
  creditsCost: number | null;
  errorCode: string | null;
  errorMessage: string | null;
};

const DEFAULT_BASE_URL = "https://api.firecrawl.dev";
const DEFAULT_TIMEOUT_MS = 60_000;

class FirecrawlNotConfiguredError extends Error {
  constructor() {
    super("FIRECRAWL_API_KEY não configurada");
    this.name = "FirecrawlNotConfiguredError";
  }
}

export function isFirecrawlConfigured(): boolean {
  return Boolean(process.env.FIRECRAWL_API_KEY?.trim());
}

/** Custo estimado em créditos por scrape, conforme o modo. */
export function estimateFirecrawlCredits(mode: "json" | "markdown"): number {
  return mode === "json" ? 5 : 1;
}

function baseUrl(): string {
  return (
    process.env.FIRECRAWL_BASE_URL?.trim().replace(/\/+$/, "") ||
    DEFAULT_BASE_URL
  );
}

function errorCodeForStatus(status: number): string {
  if (status === 401 || status === 403) return "firecrawl_unauthorized";
  if (status === 402) return "firecrawl_no_credits";
  if (status === 429) return "firecrawl_rate_limited";
  if (status >= 500) return "firecrawl_unavailable";
  return "firecrawl_error";
}

export async function scrapeWithFirecrawl(
  input: FirecrawlScrapeInput,
): Promise<FirecrawlScrapeResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
  if (!apiKey) throw new FirecrawlNotConfiguredError();

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const formats =
    input.mode === "json"
      ? [
          {
            type: "json",
            schema: TRACKING_JSON_SCHEMA,
            prompt: TRACKING_JSON_PROMPT,
          },
        ]
      : ["markdown"];

  const body: Record<string, unknown> = {
    url: input.url,
    formats,
    onlyMainContent: false,
    // Rastreio precisa ser atual; o default do Firecrawl (2 dias) devolveria
    // status velho achando que é atual.
    maxAge: 0,
    location: { country: "BR", languages: ["pt", "en"] },
    timeout: timeoutMs,
  };
  if (input.waitForMs && input.waitForMs > 0) {
    body.waitFor = input.waitForMs;
  }
  if (input.actions && input.actions.length > 0) {
    body.actions = input.actions;
  }
  if (input.proxy) {
    body.proxy = input.proxy;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs + 5_000);

  try {
    const response = await fetch(`${baseUrl()}/v2/scrape`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          success?: boolean;
          data?: {
            json?: unknown;
            markdown?: string | null;
            metadata?: { statusCode?: number | null };
          };
          creditsCost?: number | null;
          error?: unknown;
        }
      | null;

    if (!response.ok) {
      const message =
        typeof payload?.error === "string"
          ? payload.error
          : `Firecrawl respondeu ${response.status}`;
      return {
        ok: false,
        mode: input.mode,
        json: null,
        markdown: null,
        statusCode: null,
        creditsCost: null,
        errorCode: errorCodeForStatus(response.status),
        errorMessage: message.slice(0, 500),
      };
    }

    return {
      ok: payload?.success !== false,
      mode: input.mode,
      json: payload?.data?.json ?? null,
      markdown: payload?.data?.markdown ?? null,
      statusCode: payload?.data?.metadata?.statusCode ?? null,
      creditsCost:
        typeof payload?.creditsCost === "number" ? payload.creditsCost : null,
      errorCode: null,
      errorMessage: null,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      mode: input.mode,
      json: null,
      markdown: null,
      statusCode: null,
      creditsCost: null,
      errorCode: aborted ? "firecrawl_timeout" : "firecrawl_network_error",
      errorMessage:
        error instanceof Error ? error.message.slice(0, 500) : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}
