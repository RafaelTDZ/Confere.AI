import Link from "next/link";
import { Hash } from "lucide-react";
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
import { formatNcmCode, listTenantNcms, type NcmRow } from "@/lib/documents";
import { buildPage, DEFAULT_PAGE_SIZE, type Page } from "@/lib/pagination";
import { cn, formatDate } from "@/lib/utils";
import { ListFilters } from "@/components/ui/list-filters";
import { Pagination } from "@/components/ui/pagination";

export default async function NcmPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const params = await searchParams;
  const auth = await getAuthContext();
  const hasFilters = Boolean(params.q?.trim());

  let ncmPage: Page<NcmRow> = buildPage<NcmRow>([], 0, 1, DEFAULT_PAGE_SIZE);
  let loadFailed = false;
  try {
    ncmPage = await listTenantNcms(auth.tenantId, {
      page: params.page,
      search: params.q,
    });
  } catch (err) {
    console.error("[ncm] falha ao listar NCMs:", err);
    loadFailed = true;
  }

  const createButton = (
    <Link href="/ncm/nova" className={cn(buttonVariants())}>
      Cadastrar NCM
    </Link>
  );

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <FlashNotice />

      <PageHeader
        eyebrow="NCM"
        icon={Hash}
        title="Catálogo de NCM"
        description="Cadastre códigos NCM/HS e descrições deste tenant."
        actions={createButton}
      />

      {loadFailed ? (
        <Notice tone="danger" title="Não foi possível carregar as NCMs.">
          <p>
            Verifique sua conexão e tente de novo. Se o problema continuar,
            fale com o suporte.
          </p>
          <Link
            href="/ncm"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-3")}
          >
            Tentar de novo
          </Link>
        </Notice>
      ) : (
        <>
          <ListFilters
            action="/ncm"
            searchValue={params.q}
            searchPlaceholder="Buscar por código ou descrição"
            clearHref="/ncm"
          />

          {ncmPage.total === 0 ? (
            hasFilters ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Nenhum resultado</CardTitle>
                  <CardDescription>
                    Nenhuma NCM corresponde aos filtros aplicados.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Link
                    href="/ncm"
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
                    Nenhuma NCM cadastrada
                  </CardTitle>
                  <CardDescription>
                    Cadastre o primeiro código NCM/HS para este tenant.
                  </CardDescription>
                </CardHeader>
                <CardContent>{createButton}</CardContent>
              </Card>
            )
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {ncmPage.total} {ncmPage.total === 1 ? "NCM" : "NCMs"}
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-hidden p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Código</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead>Atualizado em</TableHead>
                      <TableHead>
                        <span className="sr-only">Ações</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ncmPage.rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono font-medium">
                          <Link
                            href={`/ncm/${row.id}`}
                            className="hover:underline"
                          >
                            {formatNcmCode(row.code)}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {row.description}
                        </TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                          {formatDate(row.updated_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Link
                            href={`/ncm/${row.id}`}
                            className={cn(
                              buttonVariants({ variant: "outline", size: "sm" }),
                            )}
                          >
                            Editar
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {ncmPage.total > 0 && (
            <Pagination
              page={ncmPage.page}
              totalPages={ncmPage.totalPages}
              pathname="/ncm"
              searchParams={params}
            />
          )}
        </>
      )}
    </div>
  );
}
