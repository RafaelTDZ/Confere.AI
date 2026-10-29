import Link from "next/link";
import {
  CalendarClock,
  Hourglass,
  Package,
  Radar,
  Ship,
  type LucideIcon,
} from "lucide-react";
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
import { PageHeader } from "@/components/layout/page-header";
import { getAuthContext } from "@/lib/auth";
import {
  listTenantTracking,
  type TenantTrackingList,
  type TenantTrackingRow,
  type TrackingListSummary,
} from "@/lib/tracking/list";
import {
  TRACKING_LIST_FILTERS,
  formatTrackingDate,
  formatTrackingMoment,
  normalizeTrackingListFilter,
  trackingEtaRelative,
  trackingListHref,
  trackingNextCheckLabel,
  type TrackingQueryType,
} from "@/lib/tracking/shared";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const EMPTY_SUMMARY: TrackingListSummary = {
  total: 0,
  inTransit: 0,
  arriving: 0,
  withoutEta: 0,
  withoutCheck: 0,
};

function summaryCount(
  filter: (typeof TRACKING_LIST_FILTERS)[number]["value"],
  summary: TrackingListSummary,
): number {
  switch (filter) {
    case "transito":
      return summary.inTransit;
    case "chegando":
      return summary.arriving;
    case "sem_eta":
      return summary.withoutEta;
    case "sem_consulta":
      return summary.withoutCheck;
    default:
      return summary.total;
  }
}

const QUERY_TAGS: Record<TrackingQueryType, string> = {
  bl: "BL",
  container: "CNTR",
  booking: "BOOKING",
};

const SUMMARY_ICONS: Record<
  "total" | "inTransit" | "arriving" | "withoutEta",
  LucideIcon
> = {
  total: Package,
  inTransit: Ship,
  arriving: CalendarClock,
  withoutEta: Hourglass,
};

function SummaryCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: number;
  hint?: string;
  icon: LucideIcon;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium uppercase tracking-[0.04em] text-muted-foreground">
            {label}
          </p>
          <p className="text-2xl font-semibold tabular-nums">{value}</p>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        <span className="shrink-0 rounded-md bg-muted p-2 text-muted-foreground">
          <Icon aria-hidden="true" className="h-4 w-4" />
        </span>
      </CardContent>
    </Card>
  );
}

function TrackingRow({ row }: { row: TenantTrackingRow }) {
  const eta = formatTrackingDate(row.eta);
  const etaRelative = trackingEtaRelative(row.eta, row.status);
  const lastEvent = formatTrackingMoment(row.lastEventAt);
  const nextCheck = trackingNextCheckLabel(row.status, row.nextCheckAt);

  return (
    <TableRow className="align-top">
      <TableCell>
        <Link
          href={`/importacoes/${row.importId}`}
          className="rounded-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {row.importReference ?? "Ver importação"}
        </Link>
        {row.blNumber ? (
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
            BL {row.blNumber}
          </p>
        ) : null}
      </TableCell>
      <TableCell className="hidden text-muted-foreground xl:table-cell">
        {row.carrier}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{QUERY_TAGS[row.queryType]}</Badge>
          <Link
            href={`/rastreio/${row.shipmentId}`}
            className="rounded-sm font-mono text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {row.queryValue}
          </Link>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant={row.statusVariant}>{row.statusLabel}</Badge>
      </TableCell>
      <TableCell className="tabular-nums">
        {eta ? (
          <>
            <p>{eta}</p>
            {etaRelative ? (
              <p
                className={cn(
                  "text-xs",
                  etaRelative.tone === "danger"
                    ? "font-medium text-destructive-text"
                    : "text-muted-foreground",
                )}
              >
                {etaRelative.label}
              </p>
            ) : null}
          </>
        ) : (
          <span className="text-muted-foreground">Sem ETA</span>
        )}
      </TableCell>
      <TableCell className="max-w-[280px]">
        <p className="line-clamp-2">
          {row.lastEventDescription ?? "Nenhum evento registrado ainda."}
        </p>
        {lastEvent ? (
          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
            {lastEvent}
          </p>
        ) : null}
      </TableCell>
      <TableCell className="hidden text-muted-foreground xl:table-cell">
        {nextCheck}
      </TableCell>
    </TableRow>
  );
}

export default async function RastreioPage({
  searchParams,
}: {
  searchParams: Promise<{ import?: string; filtro?: string }>;
}) {
  const params = await searchParams;
  const auth = await getAuthContext();
  const importId = params.import?.trim() || null;
  const filter = normalizeTrackingListFilter(params.filtro);

  let data: TenantTrackingList = {
    rows: [],
    summary: EMPTY_SUMMARY,
    scope: importId ? { importId, reference: null } : null,
  };
  let loadFailed = false;
  try {
    data = await listTenantTracking({
      tenantId: auth.tenantId,
      importId,
      filter,
    });
  } catch (err) {
    console.error("[rastreio] falha ao listar rastreios:", err);
    loadFailed = true;
  }

  const hasFilter = filter !== "todos";
  const scopeLabel = data.scope?.reference ?? data.scope?.importId ?? null;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <PageHeader
        eyebrow="Rastreio"
        icon={Radar}
        title="Rastreio de embarques"
        description="BLs e containers de todas as importações, com status, ETA e próxima consulta ao armador."
      />

      {loadFailed ? (
        <Notice tone="danger" title="Não foi possível carregar o rastreio.">
          <p>
            Verifique sua conexão e tente de novo. Se o problema continuar,
            fale com o suporte.
          </p>
          <Link
            href="/rastreio"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-3")}
          >
            Tentar de novo
          </Link>
        </Notice>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              label="Rastreios"
              value={data.summary.total}
              hint="BLs e containers monitorados"
              icon={SUMMARY_ICONS.total}
            />
            <SummaryCard
              label="Em trânsito"
              value={data.summary.inTransit}
              hint="Em trânsito ou transbordo"
              icon={SUMMARY_ICONS.inTransit}
            />
            <SummaryCard
              label="Chegando"
              value={data.summary.arriving}
              hint="ETA em até 7 dias"
              icon={SUMMARY_ICONS.arriving}
            />
            <SummaryCard
              label="Sem ETA"
              value={data.summary.withoutEta}
              hint="Armador ainda não informou"
              icon={SUMMARY_ICONS.withoutEta}
            />
          </div>

          {importId ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="secondary">Importação: {scopeLabel}</Badge>
              <Link
                href={trackingListHref({ filter })}
                className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                Limpar filtro da importação
              </Link>
            </div>
          ) : null}

          <div
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label="Filtrar rastreios"
          >
            {TRACKING_LIST_FILTERS.map((option) => {
              const active = option.value === filter;
              return (
                <Link
                  key={option.value}
                  href={trackingListHref({
                    importId,
                    filter: option.value,
                  })}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    buttonVariants({
                      variant: active ? "default" : "outline",
                      size: "sm",
                    }),
                    "min-h-11 tabular-nums sm:min-h-8",
                  )}
                >
                  {option.label} ({summaryCount(option.value, data.summary)})
                </Link>
              );
            })}
          </div>

          {data.summary.total === 0 ? (
            importId ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Sem rastreio nesta importação
                  </CardTitle>
                  <CardDescription>
                    Assim que o BL for extraído, o rastreio é iniciado
                    automaticamente.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Link
                    href={`/importacoes/${importId}`}
                    className={cn(buttonVariants({ variant: "outline" }))}
                  >
                    Voltar à importação
                  </Link>
                  <Link
                    href="/rastreio"
                    className={cn(buttonVariants({ variant: "ghost" }))}
                  >
                    Ver todos os rastreios
                  </Link>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Nenhum rastreio ainda</CardTitle>
                  <CardDescription>
                    Envie um BL em uma análise para começar o rastreio
                    automático do embarque.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Link href="/analise" className={cn(buttonVariants())}>
                    Nova análise
                  </Link>
                  <Link
                    href="/importacoes"
                    className={cn(buttonVariants({ variant: "outline" }))}
                  >
                    Ver importações
                  </Link>
                </CardContent>
              </Card>
            )
          ) : data.rows.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Nenhum rastreio neste filtro</CardTitle>
                <CardDescription>
                  Nenhum embarque corresponde ao filtro aplicado.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Link
                  href={trackingListHref({ importId })}
                  className={cn(buttonVariants({ variant: "outline" }))}
                >
                  Limpar filtro
                </Link>
                <Link
                  href="/importacoes"
                  className={cn(buttonVariants({ variant: "ghost" }))}
                >
                  Ver importações
                </Link>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {data.rows.length}{" "}
                  {data.rows.length === 1 ? "rastreio" : "rastreios"}
                </CardTitle>
                <CardDescription>
                  Ordenados pelo evento mais recente. A próxima consulta é
                  agendada pelo rastreio automático.
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-hidden p-0">
                <Table aria-label="Rastreios de embarques">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Importação</TableHead>
                      <TableHead className="hidden xl:table-cell">Armador</TableHead>
                      <TableHead>BL / container</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>ETA</TableHead>
                      <TableHead>Último evento</TableHead>
                      <TableHead className="hidden xl:table-cell">Próxima consulta</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((row) => (
                      <TrackingRow key={row.shipmentId} row={row} />
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {hasFilter && data.rows.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Filtro ativo.{" "}
              <Link
                href={trackingListHref({ importId })}
                className="underline underline-offset-4 hover:text-foreground"
              >
                Mostrar todos
              </Link>
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
