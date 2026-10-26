import Link from "next/link";
import { Building2, CircleCheck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getAuthContext } from "@/lib/auth";
import { listTenantParties, type PartyRow } from "@/lib/documents";
import { buildPage, DEFAULT_PAGE_SIZE, type Page } from "@/lib/pagination";
import { cn, formatDate } from "@/lib/utils";
import { EmpresaRowActions } from "@/components/empresas/empresa-row-actions";
import { ListFilters } from "@/components/ui/list-filters";
import { Pagination } from "@/components/ui/pagination";

export default async function EmpresasPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; page?: string; q?: string }>;
}) {
  const params = await searchParams;
  const auth = await getAuthContext();
  const hasFilters = Boolean(params.q?.trim());

  let partyPage: Page<PartyRow> = buildPage<PartyRow>(
    [],
    0,
    1,
    DEFAULT_PAGE_SIZE,
  );
  let error: string | null = null;
  try {
    partyPage = await listTenantParties(auth.tenantId, {
      page: params.page,
      search: params.q,
    });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      {params.saved === "ok" && (
        <p className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-foreground">
          <CircleCheck className="h-4 w-4 shrink-0 text-primary" />
          Empresa atualizada com sucesso.
        </p>
      )}

      <div>
        <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-primary">
          <Building2 className="h-4 w-4" />
          Empresas
        </p>
        <h1 className="text-2xl font-bold tracking-tight">
          Empresas cadastradas
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Consignee e notify gravados a partir das análises neste tenant.
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
            action="/empresas"
            searchValue={params.q}
            searchPlaceholder="Buscar por nome ou CNPJ"
            clearHref="/empresas"
          />

          {partyPage.total === 0 ? (
            hasFilters ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Nenhum resultado</CardTitle>
                  <CardDescription>
                    Nenhuma empresa corresponde aos filtros aplicados.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Link
                    href="/empresas"
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
                    Nenhuma empresa cadastrada
                  </CardTitle>
                  <CardDescription>
                    As empresas nascem da análise da Invoice. Envie um documento
                    para cadastrar consignee e notify.
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
                  {partyPage.total}{" "}
                  {partyPage.total === 1 ? "empresa" : "empresas"}
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="border-y bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-6 py-3 font-medium">Nome</th>
                      <th className="px-6 py-3 font-medium">CNPJ</th>
                      <th className="px-6 py-3 font-medium">Cidade</th>
                      <th className="px-6 py-3 font-medium">Estado</th>
                      <th className="px-6 py-3 font-medium">País</th>
                      <th className="px-6 py-3 font-medium">Atualizado em</th>
                      <th className="px-6 py-3 font-medium">
                        <span className="sr-only">Ações</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {partyPage.rows.map((row) => (
                      <tr
                        key={row.id}
                        className="group relative cursor-pointer border-b last:border-0 hover:bg-muted/30"
                      >
                        <td className="px-6 py-3 font-medium">
                          <Link
                            href={`/empresas/${row.id}`}
                            aria-label={`Abrir cadastro de ${row.name}`}
                            className="after:absolute after:inset-0 after:z-0 after:content-[''] group-hover:underline"
                          >
                            {row.name}
                          </Link>
                        </td>
                        <td className="px-6 py-3 text-muted-foreground">
                          {row.cnpj || "—"}
                        </td>
                        <td className="px-6 py-3 text-muted-foreground">
                          {row.address.city || "—"}
                        </td>
                        <td className="px-6 py-3 text-muted-foreground">
                          {row.address.state || "—"}
                        </td>
                        <td className="px-6 py-3 text-muted-foreground">
                          {row.address.country || "—"}
                        </td>
                        <td className="px-6 py-3 text-muted-foreground">
                          {formatDate(row.updated_at)}
                        </td>
                        <td className="px-6 py-3 text-right">
                          <EmpresaRowActions partyId={row.id} partyName={row.name} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {partyPage.total > 0 && (
            <Pagination
              page={partyPage.page}
              totalPages={partyPage.totalPages}
              pathname="/empresas"
              searchParams={params}
            />
          )}
        </>
      )}
    </div>
  );
}
