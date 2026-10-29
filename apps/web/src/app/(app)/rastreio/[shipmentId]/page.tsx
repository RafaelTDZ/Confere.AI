import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import {
  ArrowRight,
  ExternalLink,
  Hourglass,
  Radar,
} from "lucide-react";
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
import { buttonVariants } from "@/components/ui/button";
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

/** Ponto da rota (POL/POD) em uma grade de duas colunas: marcador + conteúdo. */
function RoutePoint({
  label,
  point,
  dateLabel,
  filled,
}: {
  label: string;
  point: TrackingRoutePoint | null;
  dateLabel: string;
  filled: boolean;
}) {
  return (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "mt-1 h-3.5 w-3.5 justify-self-center rounded-full border-2",
          filled ? "border-primary bg-primary" : "border-foreground bg-card",
        )}
      />
      <div className="min-w-0 space-y-0.5">
        <p className="text-xs font-medium uppercase tracking-[0.04em] text-muted-foreground">
          {label}
        </p>
        <p className="break-words font-medium">
          {point?.label ?? "Não informado"}
        </p>
        <p className="text-sm text-muted-foreground tabular-nums">
          {dateLabel}: {dateOrDash(point?.date ?? null)}
        </p>
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
        className="min-h-12 w-px self-stretch justify-self-center border-l-2 border-dashed border-border"
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3">
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

function TimelineStep({
  tone,
  label,
  value,
  hint,
  hintTone = "muted",
}: {
  tone: "muted" | "primary" | "success" | "pending";
  label: string;
  value: string;
  hint?: string | null;
  hintTone?: "muted" | "danger";
}) {
  const dot = {
    muted: "bg-muted-foreground",
    primary: "bg-primary",
    success: "bg-success",
    pending: "border-2 border-border bg-card",
  }[tone];
  return (
    <li className="relative pl-7">
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0 top-1 h-3 w-3 rounded-full ring-4 ring-card",
          dot,
        )}
      />
      <p className="text-xs font-medium uppercase tracking-[0.04em] text-muted-foreground">
        {label}
      </p>
      <p className="flex flex-wrap items-baseline gap-x-2 text-base font-semibold tabular-nums">
        <span>{value}</span>
        {hint ? (
          <span
            className={cn(
              "text-xs font-medium",
              hintTone === "danger"
                ? "text-destructive-text"
                : "text-muted-foreground",
            )}
          >
            {hint}
          </span>
        ) : null}
      </p>
    </li>
  );
}

function StatTile({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1 rounded-md border border-border bg-muted/40 p-3">
      <dt className="text-xs font-medium uppercase tracking-[0.04em] text-muted-foreground">
        {label}
      </dt>
      <dd className="break-words text-base font-semibold tabular-nums">
        {children}
        {hint ? (
          <span className="block text-xs font-normal text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

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

  // Geocodificação é acessória: falha/timeout viram `null` e o bloco cai no
  // texto `POL → POD`. Sem os dois lados não há rota para desenhar.
  const routeCoordinates =
    route.origin && route.destination
      ? await resolveRouteCoordinates({
          origin: route.origin.label,
          destination: route.destination.label,
        })
      : null;
  const showError =
    (shipment.status === "error" || shipment.status === "blocked") &&
    Boolean(shipment.errorMessage);
  const canEdit = auth.role !== "viewer";
  const hasSchedule = Boolean(shipment.eta || shipment.etaOriginal || shipment.ata);
  const etaRelative = trackingEtaRelative(shipment.eta, shipment.status);
  const destinationDateLabel = shipment.ata ? "Chegada (ATA)" : "Chegada prevista";
  const delayNote = shipment.etaOriginal
    ? shipment.ata
      ? "Atraso calculado sobre a chegada real (ATA)."
      : "Atraso calculado sobre o ETA atual."
    : "O atraso aparece após a primeira consulta com ETA.";

  const headerSubtitle = [
    shipment.carrier,
    shipment.vessel ? `Navio ${shipment.vessel}` : null,
    shipment.voyage ? `Viagem ${shipment.voyage}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <div className="shrink-0">
            <BackButton fallbackHref="/rastreio" />
          </div>
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{shipment.queryTag}</Badge>
              <h1 className="min-w-0 break-all font-mono text-2xl font-semibold tracking-tight tabular-nums">
                {shipment.queryValue}
              </h1>
            </div>
            <p className="break-words text-sm text-muted-foreground">
              {headerSubtitle}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={shipment.statusVariant}>
            <span className="sr-only">Status: </span>
            {shipment.statusLabel}
          </Badge>
          {importInfo ? (
            <Link
              href={`/importacoes/${importInfo.id}`}
              className={cn(
                buttonVariants({ variant: "ghost", size: "sm" }),
                "min-h-11 text-muted-foreground sm:min-h-8",
              )}
            >
              <ExternalLink aria-hidden="true" className="h-4 w-4" />
              {importInfo.reference
                ? `Importação ${importInfo.reference}`
                : "Abrir importação"}
            </Link>
          ) : null}
        </div>
        <TrackingActions importId={shipment.importId} canEdit={canEdit} />
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

      {siblings.length > 1 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Containers do embarque</CardTitle>
            <CardDescription>
              Selecione um shipment para ver os marcos e o atraso daquele
              container.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 p-6 pt-0">
            {siblings.map((sibling) => (
              <Link
                key={sibling.id}
                href={`/rastreio/${sibling.id}`}
                aria-current={sibling.isCurrent ? "page" : undefined}
                className={cn(
                  buttonVariants({
                    variant: sibling.isCurrent ? "default" : "outline",
                    size: "sm",
                  }),
                  "min-h-11 font-mono sm:min-h-8",
                )}
              >
                <span className="text-xs font-semibold">{sibling.queryTag}</span>
                {sibling.queryValue}
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Rota do embarque</CardTitle>
            <CardDescription>
              POL e POD informados no BL, com as datas do embarque e da
              chegada.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-center">
            <RouteMap
              origin={toMapPoint(
                route.origin,
                routeCoordinates?.origin ?? null,
              )}
              destination={toMapPoint(
                route.destination,
                routeCoordinates?.destination ?? null,
              )}
              departureDate={dateOrDash(route.origin?.date ?? null)}
              arrivalDate={dateOrDash(route.destination?.date ?? null)}
            />

            {route.origin || route.destination ? (
              <div className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3">
                <RoutePoint
                  label="Origem (POL)"
                  point={route.origin}
                  dateLabel="Embarque"
                  filled={false}
                />
                <RouteConnector
                  direct={route.direct}
                  transitDays={derived.transitDays}
                />
                <RoutePoint
                  label="Destino (POD)"
                  point={route.destination}
                  dateLabel={destinationDateLabel}
                  filled
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Rota não informada. Os portos aparecem aqui quando o BL da
                importação traz POL/POD.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Prazos</CardTitle>
            <CardDescription>
              ETA do armador, chegada real (ATA) e atraso do embarque.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {hasSchedule ? (
              <>
                <div className="relative">
                  <span
                    aria-hidden="true"
                    className="absolute bottom-2 left-[5px] top-2 w-px bg-border"
                  />
                  <ol className="relative space-y-5">
                    <TimelineStep
                      tone="muted"
                      label="ETA original"
                      value={dateOrDash(shipment.etaOriginal)}
                    />
                    <TimelineStep
                      tone="primary"
                      label="ETA atual"
                      value={dateOrDash(shipment.eta)}
                      hint={etaRelative?.label}
                      hintTone={etaRelative?.tone}
                    />
                    <TimelineStep
                      tone={shipment.ata ? "success" : "pending"}
                      label="Chegada real (ATA)"
                      value={
                        shipment.ata ? dateOrDash(shipment.ata) : "Aguardando chegada"
                      }
                    />
                  </ol>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                  {derived.delayLabel ? (
                    <Badge variant={derived.delayVariant}>
                      {derived.delayLabel}
                    </Badge>
                  ) : (
                    <Badge variant="outline">Atraso não calculado</Badge>
                  )}
                  <p className="text-xs text-muted-foreground">{delayNote}</p>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-input p-6 text-center">
                <span className="rounded-full bg-muted p-3 text-muted-foreground">
                  <Hourglass aria-hidden="true" className="h-5 w-5" />
                </span>
                <div className="space-y-1">
                  <p className="font-medium">Sem ETA do armador</p>
                  <p className="max-w-[44ch] text-sm text-muted-foreground">
                    Quando o armador informar a chegada, esta linha do tempo
                    mostra ETA, chegada real e atraso.
                  </p>
                </div>
                <TrackingRefreshButton
                  importId={shipment.importId}
                  canEdit={canEdit}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Detalhes</CardTitle>
            <CardDescription>
              Containers, transbordos e tempo de trânsito do embarque.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid gap-3 sm:grid-cols-2">
              <StatTile
                label="Containers"
                hint={
                  derived.containers.length > 0
                    ? `${derived.containers.length} ${
                        derived.containers.length === 1 ? "unidade" : "unidades"
                      }`
                    : undefined
                }
              >
                {derived.containers.length > 0 ? (
                  <ul className="space-y-0.5">
                    {derived.containers.map((container) => (
                      <li key={container} className="font-mono text-sm">
                        {container}
                      </li>
                    ))}
                  </ul>
                ) : (
                  "—"
                )}
              </StatTile>
              <StatTile
                label="Transbordos"
                hint={
                  derived.transhipments > 0
                    ? "eventos de transbordo"
                    : undefined
                }
              >
                {derived.transhipments > 0
                  ? derived.transhipments
                  : "Nenhum"}
              </StatTile>
              <StatTile
                label="Tempo de trânsito"
                hint={
                  derived.transitDays !== null
                    ? "Do 1º evento até a chegada"
                    : undefined
                }
              >
                {daysLabel(derived.transitDays) ?? "—"}
              </StatTile>
              <StatTile
                label="Navio"
                hint={shipment.voyage ? `Viagem ${shipment.voyage}` : undefined}
              >
                {shipment.vessel ?? "—"}
              </StatTile>
            </dl>

            <dl className="grid gap-3 border-t border-border pt-4 text-sm sm:grid-cols-2">
              <div className="space-y-0.5">
                <dt className="text-xs font-medium uppercase tracking-[0.04em] text-muted-foreground">
                  Última consulta
                </dt>
                <dd className="tabular-nums">
                  {formatTrackingMoment(shipment.fetchedAt) ??
                    "Ainda não consultado"}
                </dd>
              </div>
              <div className="space-y-0.5">
                <dt className="text-xs font-medium uppercase tracking-[0.04em] text-muted-foreground">
                  Próxima consulta
                </dt>
                <dd className="tabular-nums">{shipment.nextCheckLabel}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Marcos do embarque</CardTitle>
            {events.length > 0 ? (
              <Badge variant="secondary">
                {events.length} {events.length === 1 ? "evento" : "eventos"}
              </Badge>
            ) : null}
          </div>
          <CardDescription>
            Eventos do armador e lançamentos manuais, do mais recente ao mais
            antigo.
          </CardDescription>
        </CardHeader>
        {events.length === 0 ? (
          <CardContent>
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-input p-8 text-center">
              <span className="rounded-full bg-muted p-3 text-muted-foreground">
                <Radar aria-hidden="true" className="h-5 w-5" />
              </span>
              <p className="font-medium">Nenhum marco registrado ainda</p>
              <p className="max-w-[48ch] text-sm text-muted-foreground">
                Os marcos aparecem depois da primeira consulta ao armador ou de
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
                  <TableHead>Transporte/navio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event, index) => {
                  const latest = index === 0;
                  const moment = splitMoment(
                    formatTrackingMoment(event.dateIso) ?? event.dateIso,
                  );
                  const transport =
                    [event.vessel, event.voyage].filter(Boolean).join(" · ") ||
                    event.containerNumber;
                  return (
                    <TableRow
                      key={event.id}
                      className={cn(
                        "align-top",
                        latest && "bg-primary-soft/60",
                      )}
                    >
                      <TableCell className="whitespace-nowrap">
                        <p className="font-medium tabular-nums">{moment.date}</p>
                        {moment.time ? (
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {moment.time}
                          </p>
                        ) : null}
                        {latest ? (
                          <Badge variant="default" className="mt-1">
                            Mais recente
                          </Badge>
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
                      <TableCell className="text-muted-foreground">
                        {transport ? (
                          <span
                            className={cn(
                              event.vessel || event.voyage ? "" : "font-mono",
                            )}
                          >
                            {transport}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
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
