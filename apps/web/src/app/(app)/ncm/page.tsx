import Link from "next/link";
import { CircleCheck, Hash } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getAuthContext } from "@/lib/auth";
import { formatNcmCode, listTenantNcms, type NcmRow } from "@/lib/documents";
import { cn, formatDate } from "@/lib/utils";

export default async function NcmPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const params = await searchParams;
  const auth = await getAuthContext();

  let ncms: NcmRow[] = [];
  let error: string | null = null;
  try {
    ncms = await listTenantNcms(auth.tenantId);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const createButton = (
    <Link href="/ncm/nova" className={cn(buttonVariants())}>
      Cadastrar NCM
    </Link>
  );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      {params.saved === "ok" && (
        <p className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-foreground">
          <CircleCheck className="h-4 w-4 shrink-0 text-primary" />
          NCM salva com sucesso.
        </p>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-primary">
            <Hash className="h-4 w-4" />
            NCM
          </p>
          <h1 className="text-2xl font-bold tracking-tight">Catálogo de NCM</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cadastre códigos NCM/HS e descrições deste tenant.
          </p>
        </div>
        {createButton}
      </div>

      {error ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Não foi possível carregar</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      ) : ncms.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nenhuma NCM cadastrada</CardTitle>
            <CardDescription>
              Cadastre o primeiro código NCM/HS para este tenant.
            </CardDescription>
          </CardHeader>
          <CardContent>{createButton}</CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {ncms.length} {ncms.length === 1 ? "NCM" : "NCMs"}
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-y bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-6 py-3 font-medium">Código</th>
                  <th className="px-6 py-3 font-medium">Descrição</th>
                  <th className="px-6 py-3 font-medium">Atualizado em</th>
                  <th className="px-6 py-3 font-medium">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {ncms.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-6 py-3 font-medium">
                      <Link
                        href={`/ncm/${row.id}`}
                        className="hover:underline"
                      >
                        {formatNcmCode(row.code)}
                      </Link>
                    </td>
                    <td className="px-6 py-3 text-muted-foreground">
                      {row.description}
                    </td>
                    <td className="px-6 py-3 text-muted-foreground">
                      {formatDate(row.updated_at)}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <Link
                        href={`/ncm/${row.id}`}
                        className={cn(
                          buttonVariants({ variant: "outline", size: "sm" }),
                        )}
                      >
                        Editar
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
