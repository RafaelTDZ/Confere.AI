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
import { getAuthContext } from "@/lib/auth";
import {
  IMPORT_STATUS_LABELS,
  listTenantImports,
  type ImportRow,
} from "@/lib/documents";
import { cn, formatDate } from "@/lib/utils";

export default async function ImportacoesPage() {
  const auth = await getAuthContext();

  let imports: ImportRow[] = [];
  let error: string | null = null;
  try {
    imports = await listTenantImports(auth.tenantId);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-primary">
          <Package className="h-4 w-4" />
          Importações
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Suas importações</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Histórico de análises enviadas neste tenant.
        </p>
      </div>

      {error ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Não foi possível carregar</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      ) : imports.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nenhuma importação ainda</CardTitle>
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
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {imports.length}{" "}
              {imports.length === 1 ? "importação" : "importações"}
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-y bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-6 py-3 font-medium">Referência</th>
                  <th className="px-6 py-3 font-medium">Fornecedor</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Criada em</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((row) => {
                  const status = IMPORT_STATUS_LABELS[row.status] ?? {
                    label: row.status,
                    variant: "outline" as const,
                  };
                  return (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="px-6 py-3 font-medium">
                        {row.reference_number}
                      </td>
                      <td className="px-6 py-3 text-muted-foreground">
                        {row.supplier_name || "—"}
                      </td>
                      <td className="px-6 py-3">
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </td>
                      <td className="px-6 py-3 text-muted-foreground">
                        {formatDate(row.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
