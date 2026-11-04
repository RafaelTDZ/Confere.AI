"use client";

import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";

export type RouteMapPoint = {
  label: string;
  lat?: number | null;
  lng?: number | null;
};

export type RouteMapProps = {
  origin: RouteMapPoint | null;
  destination: RouteMapPoint | null;
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
 * Só desenha com as duas coordenadas: sem elas não há mapa a mostrar e o bloco
 * textual da página (`POL → POD` com datas) já cobre a rota — nada de placeholder
 * de "mapa indisponível" repetindo o que está ao lado. A geocodificação acontece
 * só no servidor (`lib/tracking/geo.ts`); o browser recebe `lat`/`lng` prontos.
 */
export function RouteMap({ origin, destination, className }: RouteMapProps) {
  if (!isLocated(origin) || !isLocated(destination)) return null;

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
        className="h-72 w-full md:h-80"
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
    </div>
  );
}
