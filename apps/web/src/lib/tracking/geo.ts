import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Geocodificação dos portos do rastreio (POL/POD) para o mapa da rota.
 *
 * O Nominatim/OpenStreetMap exige (política de uso): User-Agent identificável,
 * no máximo **1 requisição por segundo** e cache dos resultados. Por isso as
 * chamadas são serializadas neste módulo, o cache `port_geocodes` é consultado
 * antes de qualquer request e a gravação é feita apenas em sucesso.
 *
 * Toda falha (rede, timeout, status, JSON, banco) devolve `null`: a tela cai no
 * fallback textual em vez de quebrar. Nenhum endereço/consulta vai para o log —
 * `port_geocodes` é acessível só pelo service role (RLS sem policies).
 */

const DEFAULT_BASE_URL = "https://nominatim.openstreetmap.org";
const DEFAULT_USER_AGENT = "confere-ia/1.0";

/** Política do Nominatim: no máximo uma chamada por segundo. */
const NOMINATIM_MIN_INTERVAL_MS = 1_000;

/** Timeout de cada consulta (o Nominatim costuma responder em < 1s). */
const NOMINATIM_TIMEOUT_MS = 3_000;

export type GeocodedPort = {
  lat: number;
  lng: number;
  displayName: string;
};

export type RouteCoordinates = {
  origin: GeocodedPort | null;
  destination: GeocodedPort | null;
};

/**
 * `database.types.ts` é gerado do cloud depois de aplicar a migration; até a
 * regeneração, `port_geocodes` não existe no tipo `Database`. Este recorte
 * descreve só o que o cache usa (mesmo padrão de `document-parses.ts`).
 */
type QueryError = { message: string };

type PortGeocodeRow = {
  display_name: string | null;
  lat: number;
  lng: number;
};

type PortGeocodeCacheTable = {
  select(columns: string): {
    eq(
      column: string,
      value: string,
    ): {
      maybeSingle(): PromiseLike<{
        data: PortGeocodeRow | null;
        error: QueryError | null;
      }>;
    };
  };
  upsert(
    values: {
      query: string;
      display_name: string;
      lat: number;
      lng: number;
      provider: string;
    },
    options: { onConflict: string; ignoreDuplicates: boolean },
  ): PromiseLike<{ error: QueryError | null }>;
};

type PortGeocodeClient = {
  from(table: "port_geocodes"): PortGeocodeCacheTable;
};

function portGeocodeClient(): PortGeocodeClient {
  return createSupabaseAdminClient() as unknown as PortGeocodeClient;
}

/**
 * Chave canônica do cache: minúsculas, sem acentos, espaços colapsados e
 * `cidade, país` separados por `", "` (`"  Itapoá ,  Brasil "` → `"itapoa, brasil"`).
 */
export function normalizePortQuery(query: string): string {
  return query
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(",")
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(", ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCoordinate(value: number, limit: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= limit;
}

function toGeocodedPort(
  lat: unknown,
  lng: unknown,
  displayName: unknown,
  fallbackName: string,
): GeocodedPort | null {
  const latitude = typeof lat === "number" ? lat : Number(lat);
  const longitude = typeof lng === "number" ? lng : Number(lng);
  if (!isCoordinate(latitude, 90) || !isCoordinate(longitude, 180)) {
    return null;
  }
  const name =
    typeof displayName === "string" && displayName.trim()
      ? displayName.trim()
      : fallbackName;
  return { lat: latitude, lng: longitude, displayName: name };
}

async function readCachedGeocode(query: string): Promise<GeocodedPort | null> {
  try {
    const admin = portGeocodeClient();
    const { data, error } = await admin
      .from("port_geocodes")
      .select("display_name, lat, lng")
      .eq("query", query)
      .maybeSingle();

    if (error) {
      console.warn(
        "[tracking] falha ao ler o cache de geocodificação:",
        error.message,
      );
      return null;
    }
    if (!data) return null;

    return toGeocodedPort(data.lat, data.lng, data.display_name, query);
  } catch (error) {
    console.warn(
      "[tracking] falha inesperada ao ler o cache de geocodificação:",
      error instanceof Error ? error.message : "erro desconhecido",
    );
    return null;
  }
}

/**
 * Grava o resultado no cache. Corrida (mesma query em duas requisições) é
 * ignorada: o primeiro valor gravado é o mesmo porto e não pode falhar a tela.
 */
async function saveGeocode(query: string, point: GeocodedPort): Promise<void> {
  try {
    const admin = portGeocodeClient();
    const { error } = await admin.from("port_geocodes").upsert(
      {
        query,
        display_name: point.displayName,
        lat: point.lat,
        lng: point.lng,
        provider: "nominatim",
      },
      { onConflict: "query", ignoreDuplicates: true },
    );

    if (error) {
      console.warn(
        "[tracking] falha ao salvar a geocodificação do porto:",
        error.message,
      );
    }
  } catch (error) {
    console.warn(
      "[tracking] falha inesperada ao salvar a geocodificação do porto:",
      error instanceof Error ? error.message : "erro desconhecido",
    );
  }
}

/** Fila global do módulo: serializa as chamadas ao Nominatim (1 req/s). */
let nominatimQueue: Promise<unknown> = Promise.resolve();
let lastNominatimRequestAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Agenda a consulta respeitando o intervalo mínimo da política do Nominatim. */
function scheduleNominatim<T>(task: () => Promise<T>): Promise<T> {
  const scheduled = nominatimQueue.then(async () => {
    const elapsed = Date.now() - lastNominatimRequestAt;
    if (elapsed < NOMINATIM_MIN_INTERVAL_MS) {
      await sleep(NOMINATIM_MIN_INTERVAL_MS - elapsed);
    }
    try {
      return await task();
    } finally {
      lastNominatimRequestAt = Date.now();
    }
  });

  // A falha de uma consulta não pode travar a fila das próximas.
  nominatimQueue = scheduled.then(
    () => undefined,
    () => undefined,
  );
  return scheduled;
}

function geocodeBaseUrl(): string {
  const configured = process.env.GEOCODE_BASE_URL?.trim();
  return (configured || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function geocodeUserAgent(): string {
  return process.env.GEOCODE_USER_AGENT?.trim() || DEFAULT_USER_AGENT;
}

async function fetchFromNominatim(query: string): Promise<GeocodedPort | null> {
  return scheduleNominatim(async () => {
    const url = new URL(`${geocodeBaseUrl()}/search`);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("q", query);

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": geocodeUserAgent(),
      },
      signal: AbortSignal.timeout(NOMINATIM_TIMEOUT_MS),
      cache: "no-store",
    });

    if (!response.ok) {
      console.warn(
        `[tracking] Nominatim respondeu ${response.status}; sem coordenadas.`,
      );
      return null;
    }

    const payload: unknown = await response.json();
    if (!Array.isArray(payload) || payload.length === 0) return null;

    const first = payload[0];
    if (!isRecord(first)) return null;

    return toGeocodedPort(first.lat, first.lon, first.display_name, query);
  });
}

/**
 * Requisições em andamento por consulta normalizada: origem e destino iguais (ou
 * duas visitas simultâneas à mesma tela) compartilham uma única chamada externa.
 */
const pendingGeocodes = new Map<string, Promise<GeocodedPort | null>>();

async function geocodeNormalized(query: string): Promise<GeocodedPort | null> {
  try {
    const cached = await readCachedGeocode(query);
    if (cached) return cached;

    const fetched = await fetchFromNominatim(query);
    if (!fetched) return null;

    // Sucesso primeiro; o cache é acessório e nunca invalida o resultado.
    await saveGeocode(query, fetched);
    return fetched;
  } catch (error) {
    console.warn(
      "[tracking] falha ao geocodificar o porto:",
      error instanceof Error ? error.message : "erro desconhecido",
    );
    return null;
  }
}

/**
 * Coordenadas de um porto (`"cidade, país"`), do cache ou do Nominatim.
 *
 * Devolve `null` para consulta vazia ou qualquer falha — o chamador decide o
 * fallback visual. Nunca lança.
 */
export function geocodePort({
  query,
}: {
  query: string;
}): Promise<GeocodedPort | null> {
  const normalized = normalizePortQuery(query);
  if (!normalized) return Promise.resolve(null);

  const pending = pendingGeocodes.get(normalized);
  if (pending) return pending;

  const promise = geocodeNormalized(normalized).finally(() => {
    pendingGeocodes.delete(normalized);
  });
  pendingGeocodes.set(normalized, promise);
  return promise;
}

/**
 * Resolve POL e POD **em sequência** (nunca em paralelo) para não estourar o
 * limite de 1 req/s do Nominatim. Um lado sem resultado não derruba o outro.
 */
export async function resolveRouteCoordinates({
  origin,
  destination,
}: {
  origin: string | null;
  destination: string | null;
}): Promise<RouteCoordinates> {
  const originPoint = origin?.trim()
    ? await geocodePort({ query: origin })
    : null;
  const destinationPoint = destination?.trim()
    ? await geocodePort({ query: destination })
    : null;

  return { origin: originPoint, destination: destinationPoint };
}
