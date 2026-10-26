import Link from "next/link";
import { Building2, CircleAlert, CircleCheck } from "lucide-react";
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
  formatAddressLine,
  formatCnpj,
  listTenantParties,
  type ConsigneeDefault,
  type PartyRow,
} from "@/lib/documents";
import {
  getDefaultConsignee,
  listTenantPartyOptions,
  type TenantPartyOption,
} from "@/lib/documents/consignee-settings";
import { buildPage, DEFAULT_PAGE_SIZE, type Page } from "@/lib/pagination";
import { cn, formatDate } from "@/lib/utils";
import { DefaultConsigneeForm } from "@/components/empresas/default-consignee-form";
import { EmpresaRowActions } from "@/components/empresas/empresa-row-actions";
import { ListFilters } from "@/components/ui/list-filters";
import { Pagination } from "@/components/ui/pagination";

function toErrorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

export default async function EmpresasPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; page?: string; q?: string }>;
}) {
  const params = await searchParams;
  const auth = await getAuthContext();
  const hasFilters = Boolean(params.q?.trim());

  const [partyResult, consigneeResult, optionsResult] = await Promise.allSettled([
    listTenantParties(auth.tenantId, {
      page: params.page,
      search: params.q,
    }),
    getDefaultConsignee(auth.tenantId),
    listTenantPartyOptions(auth.tenantId),
  ]);

  let partyPage: Page<PartyRow> = buildPage<PartyRow>(
    [],
    0,
    1,
    DEFAULT_PAGE_SIZE,
  );
  let error: string | null = null;
  if (partyResult.status === "fulfilled") {
    partyPage = partyResult.value;
  } else {
    error = toErrorMessage(partyResult.reason);
  }

  let defaultConsignee: ConsigneeDefault | null = null;
  let partyOptions: TenantPartyOption[] = [];
  const settingsFailures: string[] = [];
  if (consigneeResult.status === "fulfilled") {
    defaultConsignee = consigneeResult.value;
  } else {
    settingsFailures.push(toErrorMessage(consigneeResult.reason));
  }
  if (optionsResult.status === "fulfilled") {
    partyOptions = optionsResult.value;
  } else {
    settingsFailures.push(toErrorMessage(optionsResult.reason));
  }
  const settingsError =
    settingsFailures.length > 0
      ? [...new Set(settingsFailures)].join(" ")
      : null;
  const canEditConsignee = auth.role === "owner" || auth.role === "admin";

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

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">Consignee padrão</CardTitle>
            <Badge variant="secondary">Vale para todas as importações</Badge>
          </div>
          <CardDescription>
            O consignee padrão é vinculado automaticamente a todas as
            importações; o documento é comparado e as divergências aparecem na
            importação.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {settingsError ? (
            <p className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              Não foi possível carregar o consignee padrão: {settingsError}
            </p>
          ) : (
            <>
              {defaultConsignee ? (
                <div className="space-y-1">
                  <p className="text-sm font-medium">{defaultConsignee.name}</p>
                  <p className="text-sm text-muted-foreground">
                    CNPJ{" "}
                    {defaultConsignee.cnpj
                      ? formatCnpj(defaultConsignee.cnpj)
                      : "—"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {formatAddressLine(defaultConsignee.address) || "—"}
                  </p>
                  <Link
                    href={`/empresas/${defaultConsignee.id}`}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    Editar cadastro
                  </Link>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhum consignee padrão definido. Sem ele, a IA continua
                  pedindo confirmação do consignee.
                </p>
              )}

              <DefaultConsigneeForm
                options={partyOptions}
                currentId={defaultConsignee?.id ?? null}
                canEdit={canEditConsignee}
              />
            </>
          )}
        </CardContent>
      </Card>

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
