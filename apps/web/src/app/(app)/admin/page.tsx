import Link from "next/link";
import { redirect } from "next/navigation";
import { Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listAdminTenants, type AdminTenantSummary } from "@/lib/admin/admin-data";
import { getAuthContext } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/settings/ai-settings";
import { cn, formatDate } from "@/lib/utils";

function formatUsd(value: number): string {
  return value > 0 ? `$${value.toFixed(4)}` : "—";
}

function AdminTenantRow({ tenant }: { tenant: AdminTenantSummary }) {
  return (
    <tr className="border-b last:border-0 hover:bg-muted/30">
      <td className="px-6 py-3">
        <p className="font-medium">{tenant.name}</p>
        <p className="text-xs text-muted-foreground">{tenant.id}</p>
      </td>
      <td className="px-6 py-3 text-muted-foreground">
        {formatDate(tenant.created_at)}
      </td>
      <td className="px-6 py-3 text-right">{tenant.imports}</td>
      <td className="px-6 py-3 text-right">{tenant.documents}</td>
      <td className="px-6 py-3 text-right">{tenant.parties}</td>
      <td className="px-6 py-3 text-right">{tenant.ncms}</td>
      <td className="px-6 py-3 text-right">
        {tenant.aiTokens.toLocaleString("pt-BR")}
      </td>
      <td className="px-6 py-3 text-right">{formatUsd(tenant.aiCostUsd)}</td>
      <td className="px-6 py-3 text-right">
        <Link
          href={`/admin/${tenant.id}`}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Abrir
        </Link>
      </td>
    </tr>
  );
}

export default async function AdminPage() {
  const auth = await getAuthContext();
  if (!isSuperAdmin(auth.email)) redirect("/analise");

  let tenants: AdminTenantSummary[] = [];
  let error: string | null = null;
  try {
    tenants = await listAdminTenants();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div>
        <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-primary">
          <Shield className="h-4 w-4" />
          Administração
        </p>
        <h1 className="text-2xl font-bold tracking-tight">
          Administração global
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Visão de todos os tenants da plataforma.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
        <Badge variant="warning">Somente leitura</Badge>
        <Badge variant="outline">Acesso auditado</Badge>
        <span className="text-muted-foreground">
          Nenhuma alteração é feita por este painel. Cada abertura de tenant é
          registrada em <code className="text-xs">audit_logs</code>.
        </span>
      </div>

      {error ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Não foi possível carregar</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      ) : tenants.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nenhum tenant encontrado</CardTitle>
            <CardDescription>
              Ainda não há tenants provisionados na plataforma.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {tenants.length} {tenants.length === 1 ? "tenant" : "tenants"}
            </CardTitle>
            <CardDescription>
              Contadores exatos e uso acumulado de IA por tenant.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="border-y bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-6 py-3 font-medium">Tenant</th>
                  <th className="px-6 py-3 font-medium">Criado em</th>
                  <th className="px-6 py-3 text-right font-medium">Importações</th>
                  <th className="px-6 py-3 text-right font-medium">Documentos</th>
                  <th className="px-6 py-3 text-right font-medium">Empresas</th>
                  <th className="px-6 py-3 text-right font-medium">NCMs</th>
                  <th className="px-6 py-3 text-right font-medium">Tokens IA</th>
                  <th className="px-6 py-3 text-right font-medium">Custo</th>
                  <th className="px-6 py-3 text-right font-medium">
                    <span className="sr-only">Abrir</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((tenant) => (
                  <AdminTenantRow key={tenant.id} tenant={tenant} />
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
