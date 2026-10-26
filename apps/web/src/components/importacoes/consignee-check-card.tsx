import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  formatAddressLine,
  formatCnpj,
  type ConsigneeDefault,
  type ConsigneeDivergence,
  type ConsigneeSnapshot,
} from "@/lib/documents";
import { cn } from "@/lib/utils";

export function ConsigneeCheckCard({
  defaultConsignee,
  documentConsignee,
  divergences,
}: {
  defaultConsignee: ConsigneeDefault | null;
  documentConsignee: ConsigneeSnapshot | null;
  divergences: ConsigneeDivergence[];
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">Consignee padrão</CardTitle>
          {defaultConsignee && (
            <Badge variant="secondary">Vale para todas as importações</Badge>
          )}
        </div>
        <CardDescription>
          {defaultConsignee
            ? "O consignee vinculado a esta importação é sempre o padrão do tenant; o documento é apenas comparado com ele."
            : "Defina um consignee padrão em Empresas para vincular todas as importações automaticamente."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {defaultConsignee ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">{defaultConsignee.name || "—"}</p>
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
              Editar em Empresas
            </Link>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              Nenhum consignee padrão definido.
            </p>
            <Link
              href="/empresas"
              className="text-sm font-medium text-primary hover:underline"
            >
              Definir em Empresas
            </Link>
          </div>
        )}

        {defaultConsignee && !documentConsignee && (
          <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-foreground">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            O documento não trouxe dados do consignee para comparar.
          </p>
        )}

        {defaultConsignee && documentConsignee && divergences.length === 0 && (
          <Badge variant="success">
            Documento confere com o consignee padrão
          </Badge>
        )}

        {defaultConsignee && documentConsignee && divergences.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="warning">
                {divergences.length}{" "}
                {divergences.length === 1 ? "divergência" : "divergências"}
              </Badge>
              <p className="text-sm font-medium">
                Divergências encontradas no documento
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-sm">
                <thead className="border-y bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Campo</th>
                    <th className="px-3 py-2 font-medium">Documento</th>
                    <th className="px-3 py-2 font-medium">Consignee padrão</th>
                  </tr>
                </thead>
                <tbody>
                  {divergences.map((divergence) => (
                    <tr
                      key={divergence.field}
                      className="border-b last:border-0"
                    >
                      <td className="px-3 py-2 font-medium">
                        {divergence.label}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2",
                          divergence.documentValue
                            ? "text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {divergence.documentValue ?? "—"}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2",
                          divergence.defaultConsigneeValue
                            ? "text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {divergence.defaultConsigneeValue ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-muted-foreground">
              O consignee vinculado a esta importação continua sendo o padrão.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
