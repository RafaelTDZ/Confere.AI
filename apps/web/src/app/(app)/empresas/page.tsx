import Link from "next/link";
import { Building2 } from "lucide-react";
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
import { listTenantParties, type PartyRow } from "@/lib/documents";
import { buildPage, DEFAULT_PAGE_SIZE, type Page } from "@/lib/pagination";
import { cn, formatDate } from "@/lib/utils";
import { EmpresaRowActions } from "@/components/empresas/empresa-row-actions";
import { ListFilters } from "@/components/ui/list-filters";
import { Pagination } from "@/components/ui/pagination";

export default async function EmpresasPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
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
  let loadFailed = false;
  try {
    partyPage = await listTenantParties(auth.tenantId, {
      page: params.page,
      search: params.q,
    });
  } catch (err) {
    console.error("[empresas] falha ao listar empresas:", err);
    loadFailed = true;
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <FlashNotice />

      <PageHeader
        eyebrow="Empresas"
        icon={Building2}
        title="Empresas cadastradas"
        description="Consignee e notify gravados a partir das análises neste tenant."
      />

      {loadFailed ? (
        <Notice tone="danger" title="Não foi possível carregar as empresas.">
          <p>
            Verifique sua conexão e tente de novo. Se o problema continuar,
            fale com o suporte.
          </p>
          <Link
            href="/empresas"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-3")}
          >
            Tentar de novo
          </Link>
        </Notice>
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
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">Empresas</CardTitle>
                  <Badge variant="secondary">{partyPage.total}</Badge>
                </div>
              </CardHeader>
              <CardContent className="overflow-hidden p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>CNPJ</TableHead>
                      <TableHead>Cidade</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>País</TableHead>
                      <TableHead>Atualizado em</TableHead>
                      <TableHead>
                        <span className="sr-only">Ações</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {partyPage.rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">
                          <Link
                            href={`/empresas/${row.id}`}
                            aria-label={`Abrir cadastro de ${row.name}`}
                            className="hover:underline"
                          >
                            {row.name}
                          </Link>
                        </TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                          {row.cnpj || "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {row.address.city || "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {row.address.state || "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {row.address.country || "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                          {formatDate(row.updated_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          <EmpresaRowActions
                            partyId={row.id}
                            partyName={row.name}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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
