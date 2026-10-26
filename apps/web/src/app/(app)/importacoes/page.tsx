import Link from "next/link";
import { CircleCheck, Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getAuthContext } from "@/lib/auth";
import {
  IMPORT_STATUS_LABELS,
  displayImportReference,
  listTenantImports,
  type ImportRow,
} from "@/lib/documents";
import { buildPage, DEFAULT_PAGE_SIZE, type Page } from "@/lib/pagination";
import { cn, formatDate } from "@/lib/utils";
import { ImportRowActions } from "@/components/importacoes/import-row-actions";
import { ListFilters } from "@/components/ui/list-filters";
import { Pagination } from "@/components/ui/pagination";

const STATUS_OPTIONS = Object.entries(IMPORT_STATUS_LABELS).map(
  ([value, { label }]) => ({ value, label }),
);

export default async function ImportacoesPage({
  searchParams,
}: {
  searchParams: Promise<{
    saved?: string;
    page?: string;
    q?: string;
    status?: string;
  }>;
}) {
  const params = await searchParams;
  const auth = await getAuthContext();
  const hasFilters = Boolean(params.q?.trim()) || Boolean(params.status?.trim());

  let importPage: Page<ImportRow> = buildPage<ImportRow>(
    [],
    0,
    1,
    DEFAULT_PAGE_SIZE,
  );
  let error: string | null = null;
  try {
    importPage = await listTenantImports(auth.tenantId, {
      page: params.page,
      search: params.q,
      status: params.status,
    });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      {params.saved === "ok" && (
        <p className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-foreground">
          <CircleCheck className="h-4 w-4 shrink-0 text-primary" />
          Importação atualizada com sucesso.
        </p>
      )}

      <div>
        <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-primary">
          <Package className="h-4 w-4" />
          Importações
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Suas importações</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Operações consolidadas por referência, número de BL ou invoice.
        </p>
      </div>

      {error ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Não foi possível carregar</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <ListFilters
            action="/importacoes"
            searchValue={params.q}
            searchPlaceholder="Buscar por referência"
            statusValue={params.status}
            statusOptions={STATUS_OPTIONS}
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
                <CardTitle className="text-base">
                  {importPage.total}{" "}
                  {importPage.total === 1 ? "importação" : "importações"}
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="border-y bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-6 py-3 font-medium">Referência</th>
                      <th className="px-6 py-3 font-medium">Invoice</th>
                      <th className="px-6 py-3 font-medium">BL</th>
                      <th className="px-6 py-3 font-medium">Status</th>
                      <th className="px-6 py-3 font-medium">Criada em</th>
                      <th className="px-6 py-3 font-medium">
                        <span className="sr-only">Ações</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {importPage.rows.map((row) => {
                      const status = IMPORT_STATUS_LABELS[row.status] ?? {
                        label: row.status,
                        variant: "outline" as const,
                      };
                      return (
                        <tr
                          key={row.id}
                          className="group relative cursor-pointer border-b last:border-0 hover:bg-muted/30"
                        >
                          <td className="px-6 py-3 font-medium">
                            <Link
                              href={`/importacoes/${row.id}`}
                              aria-label={`Abrir operação ${displayImportReference(row) || "sem referência"}`}
                              className="after:absolute after:inset-0 after:z-0 after:content-[''] group-hover:underline"
                            >
                              {displayImportReference(row) || "—"}
                            </Link>
                          </td>
                          <td className="px-6 py-3 text-muted-foreground">
                            {row.invoice_number || "—"}
                          </td>
                          <td className="px-6 py-3 text-muted-foreground">
                            {row.bl_number || "—"}
                          </td>
                          <td className="px-6 py-3">
                            <Badge variant={status.variant}>{status.label}</Badge>
                          </td>
                          <td className="px-6 py-3 text-muted-foreground">
                            {formatDate(row.created_at)}
                          </td>
                          <td className="px-6 py-3 text-right">
                            <ImportRowActions
                              importId={row.id}
                              reference={displayImportReference(row) || "sem referência"}
                              canRemove={auth.role !== "viewer"}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
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
