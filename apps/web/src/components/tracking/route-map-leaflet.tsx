"use client";

import "leaflet/dist/leaflet.css";

import { useEffect } from "react";
import {
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";

/**
 * Mapa Leaflet da rota. Carregado apenas no browser via
 * `dynamic(..., { ssr: false })` em `route-map.tsx` — Leaflet usa `window`.
 *
 * Sem chave de API: tiles do OpenStreetMap com a atribuição exigida. Os
 * marcadores usam `CircleMarker` (SVG), então não dependem das imagens padrão
 * do Leaflet (que o bundler não resolve sozinho).
 */

type RouteMapLeafletPoint = {
  label: string;
  lat: number;
  lng: number;
};

type RouteMapLeafletProps = {
  origin: RouteMapLeafletPoint;
  destination: RouteMapLeafletPoint;
};

/**
 * Cores por classe de token (mesmos tons da legenda em `route-map.tsx`), não por
 * `color`: o Leaflet grava `fill`/`stroke` como atributo SVG, e CSS sobrescreve
 * atributo, então o mapa segue o tema claro/escuro.
 */
const ORIGIN_CLASS = "fill-card stroke-foreground"; // anel vazio
const DESTINATION_CLASS = "fill-primary stroke-primary";
const ROUTE_CLASS = "stroke-primary"; // tracejada

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function FitRouteBounds({
  originLat,
  originLng,
  destinationLat,
  destinationLng,
}: {
  originLat: number;
  originLng: number;
  destinationLat: number;
  destinationLng: number;
}) {
  const map = useMap();

  useEffect(() => {
    map.fitBounds(
      [
        [originLat, originLng],
        [destinationLat, destinationLng],
      ],
      { padding: [32, 32], maxZoom: 8 },
    );
  }, [map, originLat, originLng, destinationLat, destinationLng]);

  return null;
}

export default function RouteMapLeaflet({
  origin,
  destination,
}: RouteMapLeafletProps) {
  const center: [number, number] = [
    (origin.lat + destination.lat) / 2,
    (origin.lng + destination.lng) / 2,
  ];

  return (
    <MapContainer
      center={center}
      zoom={3}
      scrollWheelZoom={false}
      worldCopyJump
      className="h-full w-full"
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution={OSM_ATTRIBUTION}
      />
      <Polyline
        positions={[
          [origin.lat, origin.lng],
          [destination.lat, destination.lng],
        ]}
        pathOptions={{
          className: ROUTE_CLASS,
          weight: 2,
          opacity: 0.9,
          dashArray: "6 8",
        }}
      />
      <CircleMarker
        center={[origin.lat, origin.lng]}
        radius={7}
        pathOptions={{
          className: ORIGIN_CLASS,
          fillOpacity: 1,
          weight: 2,
        }}
      >
        <Tooltip direction="top" offset={[0, -8]}>
          {origin.label} (POL)
        </Tooltip>
      </CircleMarker>
      <CircleMarker
        center={[destination.lat, destination.lng]}
        radius={7}
        pathOptions={{
          className: DESTINATION_CLASS,
          fillOpacity: 1,
          weight: 2,
        }}
      >
        <Tooltip direction="top" offset={[0, -8]}>
          {destination.label} (POD)
        </Tooltip>
      </CircleMarker>
      <FitRouteBounds
        originLat={origin.lat}
        originLng={origin.lng}
        destinationLat={destination.lat}
        destinationLng={destination.lng}
      />
    </MapContainer>
  );
}
