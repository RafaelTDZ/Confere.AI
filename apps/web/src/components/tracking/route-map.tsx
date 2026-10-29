"use client";

import dynamic from "next/dynamic";
import { ArrowRight, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

export type RouteMapPoint = {
  label: string;
  lat?: number | null;
  lng?: number | null;
};

export type RouteMapProps = {
  origin: RouteMapPoint | null;
  destination: RouteMapPoint | null;
  /** Datas já formatadas para exibição (DD/MM/AAAA). */
  departureDate?: string | null;
  arrivalDate?: string | null;
  className?: string;
};

type LocatedPoint = RouteMapPoint & { lat: number; lng: number };

/**
 * Leaflet toca em `window` no import, então o mapa só existe no browser:
 * `ssr: false` mantém o pacote fora do HTML e do bundle inicial.
 */
const RouteMapLeaflet = dynamic(
  () => import("@/components/tracking/route-map-leaflet"),
  {
    ssr: false,
    loading: () => (
      <div
        role="status"
        className="flex h-full items-center justify-center bg-muted text-xs text-muted-foreground"
      >
        Carregando mapa…
      </div>
    ),
  },
);

/** O mapa só aparece com os dois lados resolvidos e dentro das faixas válidas. */
function isLocated(point: RouteMapPoint | null): point is LocatedPoint {
  return (
    point !== null &&
    typeof point.lat === "number" &&
    typeof point.lng === "number" &&
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    Math.abs(point.lat) <= 90 &&
    Math.abs(point.lng) <= 180
  );
}

/**
 * Mapa da rota POL → POD (OpenStreetMap/Leaflet, sem chave de API).
 *
 * Sem as duas coordenadas o bloco cai no traçado textual `POL → POD` — nunca
 * renderiza um mapa quebrado. A geocodificação acontece só no servidor
 * (`lib/tracking/geo.ts`); o browser recebe `lat`/`lng` já resolvidos.
 */
export function RouteMap({
  origin,
  destination,
  departureDate = null,
  arrivalDate = null,
  className,
}: RouteMapProps) {
  if (isLocated(origin) && isLocated(destination)) {
    return (
      <div
        className={cn(
          "relative isolate z-0 overflow-hidden rounded-lg border border-border bg-muted",
          className,
        )}
      >
        <div
          role="region"
          aria-label={`Mapa da rota ${origin.label} até ${destination.label}`}
          className="h-72 w-full md:h-96"
        >
          <RouteMapLeaflet
            origin={{ label: origin.label, lat: origin.lat, lng: origin.lng }}
            destination={{
              label: destination.label,
              lat: destination.lat,
              lng: destination.lng,
            }}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-card px-4 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-full border-2 border-foreground"
              />
              {origin.label}
            </span>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="inline-flex items-center gap-1.5 font-medium">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-full bg-primary"
              />
              {destination.label}
            </span>
          </div>
          <span className="text-muted-foreground">
            Saída: {departureDate ?? "—"} · Chegada: {arrivalDate ?? "—"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative flex min-h-40 flex-col justify-between gap-4 overflow-hidden rounded-lg border border-dashed border-input bg-muted p-4",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-6 top-1/2 border-t border-dashed border-border"
      />
      <div className="relative flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1 font-medium">
          <MapPin className="h-4 w-4 text-primary" />
          {origin?.label ?? "POL não informado"}
        </span>
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
        <span className="inline-flex items-center gap-1 font-medium">
          <MapPin className="h-4 w-4 text-primary" />
          {destination?.label ?? "POD não informado"}
        </span>
      </div>
      <div className="relative flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Saída: {departureDate ?? "—"}</span>
        <span>Chegada: {arrivalDate ?? "—"}</span>
      </div>
      <p className="relative text-xs font-medium uppercase tracking-[0.04em] text-muted-foreground">
        Mapa indisponível para esta rota
      </p>
    </div>
  );
}
