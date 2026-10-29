import Link from "next/link";
import { Package } from "lucide-react";
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
import { FlashNotice } from "@/components/ui/flash-notice";
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
  IMPORT_SHIPMENT_STAGE_LABELS,
  IMPORT_SORT_LABELS,
  IMPORT_STATUS_LABELS,
  displayImportReference,
  importShipmentStage,
  listTenantImports,
  normalizeImportSort,
  type ImportRow,
} from "@/lib/documents";
import { buildPage, DEFAULT_PAGE_SIZE, type Page } from "@/lib/pagination";
import { cn } from "@/lib/utils";
import { ImportRowActions } from "@/components/importacoes/import-row-actions";
import { ListFilters } from "@/components/ui/list-filters";
import { Pagination } from "@/components/ui/pagination";

const STATUS_OPTIONS = Object.entries(IMPORT_STATUS_LABELS).map(
  ([value, { label }]) => ({ value, label }),
);

const SORT_OPTIONS = Object.entries(IMPORT_SORT_LABELS).map(
  ([value, label]) => ({ value, label }),
);

const SHIPMENT_STAGE_VARIANTS = {
  awaiting_shipment: "secondary",
  in_transit: "default",
  arrived: "success",
} as const;

export default async function ImportacoesPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    q?: string;
    status?: string;
    sort?: string;
  }>;
}) {
  const params = await searchParams;
  const auth = await getAuthContext();
  const sort = normalizeImportSort(params.sort);
  const hasFilters = Boolean(params.q?.trim()) || Boolean(params.status?.trim());

  let importPage: Page<ImportRow> = buildPage<ImportRow>(
    [],
    0,
    1,
    DEFAULT_PAGE_SIZE,
  );
  let loadFailed = false;
  try {
    importPage = await listTenantImports(auth.tenantId, {
      page: params.page,
      search: params.q,
      status: params.status,
      sort,
    });
  } catch (err) {
    console.error("[importacoes] falha ao listar importações:", err);
    loadFailed = true;
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <FlashNotice />

      <PageHeader
        eyebrow="Importações"
        icon={Package}
        title="Suas importações"
        description="Operações consolidadas por referência, número de BL ou invoice."
      />

      {loadFailed ? (
        <Notice tone="danger" title="Não foi possível carregar as importações.">
          <p>
            Verifique sua conexão e tente de novo. Se o problema continuar,
            fale com o suporte.
          </p>
          <Link
            href="/importacoes"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-3")}
          >
            Tentar de novo
          </Link>
        </Notice>
      ) : (
        <>
          <ListFilters
            action="/importacoes"
            searchValue={params.q}
            searchPlaceholder="Buscar por referência"
            statusValue={params.status}
            statusOptions={STATUS_OPTIONS}
            sortValue={sort}
            sortOptions={SORT_OPTIONS}
            clearHref="/importacoes"
          />

          {importPage.total === 0 ? (
            hasFilters ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Nenhum resultado</CardTitle>
                  <CardDescription>
                    Nenhuma importação corresponde aos filtros aplicados.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Link
                    href="/importacoes"
                    className={cn(buttonVariants({ variant: "outline" }))}
                  >
                    Limpar filtros
                  </Link>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Nenhuma importação ainda
                  </CardTitle>
                  <CardDescription>
                    Envie Invoice, Packing List ou BL para começar uma análise.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Link href="/analise" className={cn(buttonVariants())}>
                    Nova análise
                  </Link>
                </CardContent>
              </Card>
            )
          ) : (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">Importações</CardTitle>
                  <Badge variant="secondary">{importPage.total}</Badge>
                </div>
              </CardHeader>
              <CardContent className="overflow-hidden p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Referência</TableHead>
                      <TableHead>Invoice</TableHead>
                      <TableHead>BL</TableHead>
                      <TableHead>ETA</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>
                        <span className="sr-only">Ações</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importPage.rows.map((row) => {
                      const stage = importShipmentStage({
                        onboardDate: row.onboardDate,
                        status: row.trackingStatus,
                      });
                      return (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium">
                            <Link
                              href={`/importacoes/${row.id}`}
                              aria-label={`Abrir operação ${displayImportReference(row) || "sem referência"}`}
                              className="hover:underline"
                            >
                              {displayImportReference(row) || "—"}
                            </Link>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {row.invoice_number || "—"}
                          </TableCell>
                          <TableCell className="font-mono text-muted-foreground">
                            {row.bl_number || "—"}
                          </TableCell>
                          <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                            {row.eta || "—"}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge variant={SHIPMENT_STAGE_VARIANTS[stage]}>
                                {IMPORT_SHIPMENT_STAGE_LABELS[stage]}
                              </Badge>
                              {(row.consignee_divergences?.length ?? 0) > 0 && (
                                <Badge variant="warning">
                                  Divergência consignee
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <ImportRowActions
                              importId={row.id}
                              reference={displayImportReference(row) || "sem referência"}
                              canRemove={auth.role !== "viewer"}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {importPage.total > 0 && (
            <Pagination
              page={importPage.page}
              totalPages={importPage.totalPages}
              pathname="/importacoes"
              searchParams={params}
            />
          )}
        </>
      )}
    </div>
  );
}
