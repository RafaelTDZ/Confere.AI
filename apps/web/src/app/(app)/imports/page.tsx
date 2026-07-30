import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const STATUS_LABEL: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" }> = {
  uploaded: { label: "Aguardando docs", variant: "secondary" },
  processing: { label: "Processando", variant: "warning" },
  awaiting_review: { label: "Revisao pendente", variant: "default" },
  completed: { label: "Concluida", variant: "success" },
  rejected: { label: "Rejeitada", variant: "destructive" },
};

export default async function ImportsPage() {
  const ctx = await getAuthContext().catch(() => null);
  if (!ctx) redirect("/login");

  const supabase = await createSupabaseServerClient();
  const { data: imports } = await supabase
    .from("imports")
    .select("id, reference_number, status, supplier_name, created_at")
    .eq("tenant_id", ctx.tenantId)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Importacoes</h1>
          <p className="text-sm text-muted-foreground">
            Processos de importacao e analises de IA
          </p>
        </div>
        <Link
          href="/imports/new"
          className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
        >
          Nova importacao
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ultimas importacoes</CardTitle>
          <CardDescription>{imports?.length ?? 0} registros</CardDescription>
        </CardHeader>
        <CardContent>
          {!imports || imports.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma importacao ainda. Crie a primeira para comecar.
            </p>
          ) : (
            <ul className="divide-y">
              {imports.map((imp) => {
                const status = STATUS_LABEL[imp.status] ?? {
                  label: imp.status,
                  variant: "outline" as const,
                };
                return (
                  <li key={imp.id}>
                    <Link
                      href={`/imports/${imp.id}`}
                      className="flex items-center justify-between py-3 transition-colors hover:bg-accent/50"
                    >
                      <div className="px-2">
                        <p className="font-medium">{imp.reference_number}</p>
                        <p className="text-xs text-muted-foreground">
                          {imp.supplier_name ?? "Fornecedor nao identificado"}
                          {" — "}
                          {formatDate(imp.created_at)}
                        </p>
                      </div>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
