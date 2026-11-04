import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ArrowRight, Radar } from "lucide-react";
import { BackButton } from "@/components/layout/back-button";
import {
  TrackingActions,
  TrackingRefreshButton,
} from "@/components/tracking/tracking-actions";
import {
  RouteMap,
  type RouteMapPoint,
} from "@/components/tracking/route-map";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getAuthContext } from "@/lib/auth";
import {
  getTrackingShipmentDetail,
  TrackingShipmentNotFoundError,
  type TrackingRoutePoint,
} from "@/lib/tracking/detail";
import { resolveRouteCoordinates, type GeocodedPort } from "@/lib/tracking/geo";
import {
  formatTrackingDate,
  formatTrackingMoment,
  trackingEtaRelative,
} from "@/lib/tracking/shared";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function dateOrDash(value: string | null | undefined): string {
  return formatTrackingDate(value) ?? "—";
}

function daysLabel(days: number | null): string | null {
  if (days === null) return null;
  return `${days} ${days === 1 ? "dia" : "dias"}`;
}

/** Data e hora separadas para a coluna de marcos (`DD/MM/AAAA HH:MM`). */
function splitMoment(moment: string): { date: string; time: string | null } {
  const parts = moment.split(" ");
  return { date: parts[0] ?? moment, time: parts[1] ?? null };
}

/** O BL só traz cidade/país; `lat`/`lng` entram quando o geocode resolve o porto. */
function toMapPoint(
  point: TrackingRoutePoint | null,
  coordinates: GeocodedPort | null,
): RouteMapPoint | null {
  return point
    ? {
        label: point.label,
        lat: coordinates?.lat ?? null,
        lng: coordinates?.lng ?? null,
      }
    : null;
}

/** Bolinha de status dos chips de embarque (mesmos tokens do `Badge`). */
const STATUS_DOT: Record<string, string> = {
  default: "bg-primary",
  secondary: "bg-muted-foreground",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  outline: "bg-muted-foreground",
};

/** Ponto da rota (POL/POD) em uma grade de duas colunas: marcador + conteúdo. */
function RoutePoint({
  label,
  point,
  filled,
  /** Estende a linha tracejada abaixo do marcador (origem) até o conector. */
  connect = false,
  children,
}: {
  label: string;
  point: TrackingRoutePoint | null;
  filled: boolean;
  connect?: boolean;
  children?: ReactNode;
}) {
  return (
    <>
      <div className="flex flex-col items-center self-stretch">
        <span
          aria-hidden="true"
          className={cn(
            "mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2",
            filled ? "border-primary bg-primary" : "border-foreground bg-card",
          )}
        />
        {connect ? (
          <span
            aria-hidden="true"
            className="mt-1 w-0 flex-1 self-center border-l-2 border-dashed border-border"
          />
        ) : null}
      </div>
      <div className="min-w-0 space-y-1">
        <div className="space-y-0.5">
          <p className="text-xs font-medium uppercase tracking-[0.04em] text-muted-foreground">
            {label}
          </p>
          <p className="break-words font-medium">
            {point?.label ?? "Não informado"}
          </p>
        </div>
        {children ? (
          <div className="space-y-1.5 text-sm text-muted-foreground tabular-nums">
            {children}
          </div>
        ) : null}
      </div>
    </>
  );
}

function RouteConnector({
  direct,
  transitDays,
}: {
  direct: boolean;
  transitDays: number | null;
}) {
  const transit = daysLabel(transitDays);
  return (
    <>
      <span
        aria-hidden="true"
        className="min-h-16 w-px self-stretch justify-self-center border-l-2 border-dashed border-border"
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-4">
        <Badge variant={direct ? "secondary" : "warning"}>
          {direct ? "Direto" : "Com transbordo"}
        </Badge>
        {transit ? (
          <span className="flex items-center gap-1 text-xs font-medium tabular-nums text-muted-foreground">
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            Trânsito {transit}
          </span>
        ) : null}
      </div>
    </>
  );
}

type ContainerItem = {
  value: string;
  statusVariant: string | null;
  statusLabel: string | null;
};

export default async function RastreioShipmentPage({
  params,
}: {
  params: Promise<{ shipmentId: string }>;
}) {
  const { shipmentId } = await params;
  const auth = await getAuthContext();

  let detail;
  try {
    detail = await getTrackingShipmentDetail({
      tenantId: auth.tenantId,
      shipmentId,
    });
  } catch (error) {
    if (error instanceof TrackingShipmentNotFoundError) notFound();
    throw error;
  }

  const { shipment, import: importInfo, route, derived, events, siblings } =
    detail;

  // Geocodificação é acessória: falha/timeout viram `null` e o mapa simplesmente
  // não é renderizado (a coluna textual continua mostrando POL → POD).
  const routeCoordinates =
    route.origin && route.destination
      ? await resolveRouteCoordinates({
          origin: route.origin.label,
          destination: route.destination.label,
        })
      : null;
  const mapOrigin = toMapPoint(route.origin, routeCoordinates?.origin ?? null);
  const mapDestination = toMapPoint(
    route.destination,
    routeCoordinates?.destination ?? null,
  );

  const showError =
    (shipment.status === "error" || shipment.status === "blocked") &&
    Boolean(shipment.errorMessage);
  const canEdit = auth.role !== "viewer";
  const etaRelative = trackingEtaRelative(shipment.eta, shipment.status);

  const headerSubtitle = [
    shipment.carrier,
    shipment.vessel ? `Navio ${shipment.vessel}` : null,
    shipment.voyage ? `Viagem ${shipment.voyage}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // O cabeçalho mostra o BL do processo (não o container consultado); sem BL na
  // importação cai para o alvo do rastreio (BL master, container ou booking).
  const headerBl = importInfo?.blNumber ?? null;
  const headerValue = headerBl ?? shipment.queryValue;
  const title = importInfo?.reference ?? shipment.queryValue;
  const showHeaderValue = headerValue !== title;

  // Lista de containers do embarque (sem clique): shipments de container da
  // importação + containers citados no BL/eventos que não têm shipment próprio.
  const containers: ContainerItem[] = siblings
    .filter((sibling) => sibling.queryType === "container")
    .map((sibling) => ({
      value: sibling.queryValue,
      statusVariant: sibling.statusVariant,
      statusLabel: sibling.statusLabel,
    }));
  // Shipment aberto: o container consultado (ou o container do BL master) ganha
  // destaque na lista — é dele que vêm os eventos e prazos abaixo.
  const currentContainer = (
    shipment.containerNumber ??
    (shipment.queryType === "container" ? shipment.queryValue : null)
  )?.trim().toUpperCase() ?? null;
  const knownContainers = new Set(
    containers.map((container) => container.value.trim().toUpperCase()),
  );
  for (const container of derived.containers) {
    if (knownContainers.has(container.toUpperCase())) continue;
    knownContainers.add(container.toUpperCase());
    containers.push({ value: container, statusVariant: null, statusLabel: null });
  }

  // Geocodificação resolveu os dois portos: o mapa vira a coluna esquerda e a
  // rota/prazos ficam ao lado. Sem mapa, a card usa as duas colunas no texto.
  const hasMap = Boolean(
    routeCoordinates?.origin && routeCoordinates?.destination,
  );

  // Coluna "Navio" no histórico: o navio de cada evento (só aparece se algum
  // evento trouxer navio). O container saiu da tabela — a página já é de um
  // embarque só e os containers têm card próprio.
  const showVesselColumn = events.some((event) => Boolean(event.vessel));

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 space-y-1">
          {/* Mesma estrutura da página do processo: voltar + título na mesma
              linha (centralizados) e o detalhe alinhado abaixo do título. */}
          <div className="flex min-w-0 items-center gap-2">
            <BackButton
              fallbackHref={
                importInfo ? `/importacoes/${importInfo.id}` : "/rastreio"
              }
              className="size-11 sm:size-9"
            />
            <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight text-balance">
              {title}
            </h1>
          </div>
          <div className="min-w-0 space-y-1 pl-[3.25rem] sm:pl-11">
            {/* O processo (importação) é o título; o BL do processo vem abaixo,
                junto do armador/navio. O container consultado fica no card do
                mapa. */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <Badge variant="outline">{headerBl ? "BL" : shipment.queryTag}</Badge>
              {showHeaderValue ? (
                <span className="break-all font-mono font-medium tabular-nums">
                  {headerValue}
                </span>
              ) : null}
            </div>
            {headerSubtitle ? (
              <p className="break-words text-sm text-muted-foreground">
                {headerSubtitle}
              </p>
            ) : null}
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground tabular-nums">
              <span>
                Última consulta:{" "}
                {formatTrackingMoment(shipment.fetchedAt) ??
                  "ainda não consultado"}
              </span>
              <span aria-hidden="true">·</span>
              <span>Próxima: {shipment.nextCheckLabel}</span>
            </p>
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 lg:max-w-[30rem] lg:justify-end">
          <TrackingActions
            importId={shipment.importId}
            eventHref={`/rastreio/${shipment.id}/evento`}
            canEdit={canEdit}
          />
        </div>
      </header>

      {showError ? (
        <Notice tone="danger">{shipment.errorMessage}</Notice>
      ) : null}

      {shipment.vesselMismatch ? (
        <Notice tone="warning">
          Navio no portal diferente do BL (esperado{" "}
          <span className="font-medium">
            {shipment.vesselMismatch.expected}
          </span>
          , encontrado{" "}
          <span className="font-medium">{shipment.vesselMismatch.found}</span>
          ) — possível transbordo/rollover.
        </Notice>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Rota e prazos</CardTitle>
          <CardDescription>
            Portos do BL, transbordo e trânsito, com as datas do embarque e a
            previsão do armador.
          </CardDescription>
        </CardHeader>
        <CardContent
          className={cn(
            "grid gap-6",
            hasMap ? "lg:grid-cols-2 lg:items-stretch" : "md:grid-cols-2",
          )}
        >
          {hasMap ? (
            <RouteMap origin={mapOrigin} destination={mapDestination} />
          ) : null}

          <div
            className={cn(
              "flex flex-col gap-4",
              hasMap && "lg:border-l lg:border-border lg:pl-6",
            )}
          >
            {route.origin || route.destination ? (
              <div
                className={cn(
                  "grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3",
                  // Com mapa, a rota ocupa a altura disponível: a linha
                  // tracejada acompanha o mapa de cima a baixo. O `py` evita
                  // que ela cole nas bordas do mapa.
                  hasMap && "flex-1 grid-rows-[auto_1fr_auto] lg:py-4",
                )}
              >
                <RoutePoint
                  label="Origem (POL)"
                  point={route.origin}
                  filled={false}
                  connect
                >
                  {route.onboardDate ? (
                    <p>Embarque {dateOrDash(route.onboardDate)}</p>
                  ) : null}
                </RoutePoint>
                <RouteConnector
                  direct={route.direct}
                  transitDays={derived.transitDays}
                />
                <RoutePoint
                  label="Destino (POD)"
                  point={route.destination}
                  filled
                >
                  {shipment.eta ? (
                    <>
                      <p>
                        ETA {dateOrDash(shipment.eta)}
                        {etaRelative ? (
                          <span
                            className={cn(
                              "ml-1.5 text-xs font-medium",
                              etaRelative.tone === "danger"
                                ? "text-destructive-text"
                                : "text-muted-foreground",
                            )}
                          >
                            {etaRelative.label}
                          </span>
                        ) : null}
                      </p>
                      {derived.delayLabel ? (
                        <Badge variant={derived.delayVariant}>
                          {derived.delayLabel}
                        </Badge>
                      ) : null}
                    </>
                  ) : (
                    <p>ETA ainda não informado pelo armador</p>
                  )}
                </RoutePoint>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Rota não informada. Os portos aparecem aqui quando o BL da
                importação traz POL/POD.
              </p>
            )}

            {/* Sem ETA e sem chegada: o CTA de consultar continua visível
                mesmo quando o BL já trouxe a data de embarque. */}
            {!shipment.eta && !shipment.ata ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-input p-3">
                <p className="text-xs text-muted-foreground">
                  O armador ainda não informou a chegada.
                </p>
                <TrackingRefreshButton
                  importId={shipment.importId}
                  canEdit={canEdit}
                />
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {containers.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Containers do embarque</CardTitle>
            <CardDescription>
              {containers.length === 1
                ? "O embarque tem 1 container."
                : `O embarque tem ${containers.length} containers; o destacado é o deste acompanhamento.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {containers.map((container) => {
                const isCurrent =
                  container.value.trim().toUpperCase() === currentContainer;
                return (
                  <li
                    key={container.value}
                    aria-current={isCurrent ? "true" : undefined}
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-3 py-2 font-mono text-sm tabular-nums",
                      isCurrent
                        ? "border-primary/40 bg-primary-soft/60 font-semibold text-foreground"
                        : "border-border text-muted-foreground",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        STATUS_DOT[container.statusVariant ?? "outline"],
                      )}
                    />
                    <span className="min-w-0 break-all">{container.value}</span>
                    {isCurrent ? (
                      <span className="ml-auto text-xs font-medium text-muted-foreground">
                        atual
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Histórico do embarque</CardTitle>
            {events.length > 0 ? (
              <Badge variant="secondary">
                {events.length} {events.length === 1 ? "evento" : "eventos"}
              </Badge>
            ) : null}
          </div>
          <CardDescription>
            Eventos do armador e lançamentos manuais, do mais recente ao
            antigo.
          </CardDescription>
        </CardHeader>
        {events.length === 0 ? (
          <CardContent>
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-input p-8 text-center">
              <span className="rounded-full bg-muted p-3 text-muted-foreground">
                <Radar aria-hidden="true" className="h-5 w-5" />
              </span>
              <p className="font-medium">Nenhum evento registrado ainda</p>
              <p className="max-w-[48ch] text-sm text-muted-foreground">
                Os eventos aparecem depois da primeira consulta ao armador ou de
                um evento manual lançado acima.
              </p>
            </div>
          </CardContent>
        ) : (
          <CardContent className="max-h-[32rem] overflow-y-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Local</TableHead>
                  <TableHead>Evento</TableHead>
                  {showVesselColumn ? (
                    <TableHead>Navio</TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event, index) => {
                  const moment = splitMoment(
                    formatTrackingMoment(event.dateIso) ?? event.dateIso,
                  );
                  return (
                    <TableRow
                      key={event.id}
                      className={cn(
                        "align-top",
                        index === 0 && "bg-primary-soft/60",
                      )}
                    >
                      <TableCell className="whitespace-nowrap">
                        <p className="font-medium tabular-nums">{moment.date}</p>
                        {moment.time ? (
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {moment.time}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant={event.statusVariant}>
                          {event.statusLabel}
                        </Badge>
                        {event.source === "manual" ? (
                          <Badge variant="outline" className="ml-1">
                            manual
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {event.location ?? "—"}
                      </TableCell>
                      <TableCell className="max-w-[360px] break-words">
                        {event.description ?? "Evento sem descrição"}
                      </TableCell>
                      {showVesselColumn ? (
                        <TableCell className="text-muted-foreground">
                          {event.vessel ?? "—"}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
