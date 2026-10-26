import Link from "next/link";
import { notFound, redirect } from "next/navigation";
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
import {
  getAdminTenantDetail,
  recordAdminTenantView,
} from "@/lib/admin/admin-data";
import { getAuthContext } from "@/lib/auth";
import { IMPORT_STATUS_LABELS } from "@/lib/documents";
import { isSuperAdmin } from "@/lib/settings/ai-settings";
import { cn, formatDate } from "@/lib/utils";

function formatUsd(value: number | null): string {
  return value && value > 0 ? `$${value.toFixed(4)}` : "—";
}

function CountCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="p-4">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

export default async function AdminTenantPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const auth = await getAuthContext();
  if (!isSuperAdmin(auth.email)) redirect("/analise");

  const detail = await getAdminTenantDetail(tenantId);
  if (!detail) notFound();

  try {
    await recordAdminTenantView({
      actorTenantId: auth.tenantId,
      actorUserId: auth.userId,
      viewedTenantId: tenantId,
      path: `/admin/${tenantId}`,
    });
  } catch (error) {
    console.error("[admin] falha ao registrar auditoria:", error);
  }

  const { tenant, counts } = detail;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div>
        <Link
          href="/admin"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-3 mb-2")}
        >
          ← Voltar
        </Link>
        <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-primary">
          <Shield className="h-4 w-4" />
          Administração global
        </p>
        <h1 className="text-2xl font-bold tracking-tight">{tenant.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>
            ID: <code className="text-xs">{tenant.id}</code>
          </span>
          <span>·</span>
          <span>Criado em {formatDate(tenant.created_at)}</span>
          <Badge variant="warning">somente leitura · acesso auditado</Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <CountCard label="Importações" value={counts.imports} />
        <CountCard label="Documentos" value={counts.documents} />
        <CountCard label="Empresas" value={counts.parties} />
        <CountCard label="NCMs" value={counts.ncms} />
        <CountCard label="Logs de IA" value={counts.aiLogs} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Últimas importações</CardTitle>
          <CardDescription>Até 50 operações, das mais recentes.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-y bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-6 py-3 font-medium">Referência</th>
                <th className="px-6 py-3 font-medium">Invoice</th>
                <th className="px-6 py-3 font-medium">BL</th>
                <th className="px-6 py-3 font-medium">Fornecedor</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium">Criada em</th>
              </tr>
            </thead>
            <tbody>
              {detail.imports.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-6 text-center text-muted-foreground"
                  >
                    Nenhuma importação registrada.
                  </td>
                </tr>
              ) : (
                detail.imports.map((row) => {
                  const status = IMPORT_STATUS_LABELS[row.status] ?? {
                    label: row.status,
                    variant: "outline" as const,
                  };
                  return (
                    <tr
                      key={row.id}
                      className="border-b last:border-0 hover:bg-muted/30"
                    >
                      <td className="px-6 py-3 font-medium">
                        {row.reference_number || "—"}
                      </td>
                      <td className="px-6 py-3 text-muted-foreground">
                        {row.invoice_number || "—"}
                      </td>
                      <td className="px-6 py-3 text-muted-foreground">
                        {row.bl_number || "—"}
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
                })
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Empresas</CardTitle>
          <CardDescription>Até 50 empresas do tenant.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="border-y bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-6 py-3 font-medium">Nome</th>
                <th className="px-6 py-3 font-medium">CNPJ</th>
                <th className="px-6 py-3 font-medium">Cidade/UF</th>
                <th className="px-6 py-3 font-medium">Criada em</th>
              </tr>
            </thead>
            <tbody>
              {detail.parties.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-6 py-6 text-center text-muted-foreground"
                  >
                    Nenhuma empresa cadastrada.
                  </td>
                </tr>
              ) : (
                detail.parties.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-6 py-3 font-medium">{row.name}</td>
                    <td className="px-6 py-3 text-muted-foreground">
                      {row.cnpj || "—"}
                    </td>
                    <td className="px-6 py-3 text-muted-foreground">
                      {[row.city, row.state].filter(Boolean).join(" / ") || "—"}
                    </td>
                    <td className="px-6 py-3 text-muted-foreground">
                      {formatDate(row.created_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">NCMs</CardTitle>
          <CardDescription>Até 50 códigos, em ordem alfabética.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="border-y bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-6 py-3 font-medium">Código</th>
                <th className="px-6 py-3 font-medium">Descrição</th>
                <th className="px-6 py-3 font-medium">Atualizada em</th>
              </tr>
            </thead>
            <tbody>
              {detail.ncms.length === 0 ? (
                <tr>
                  <td
                    colSpan={3}
                    className="px-6 py-6 text-center text-muted-foreground"
                  >
                    Nenhuma NCM cadastrada.
                  </td>
                </tr>
              ) : (
                detail.ncms.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-6 py-3 font-medium">{row.code}</td>
                    <td className="px-6 py-3 text-muted-foreground">
                      {row.description}
                    </td>
                    <td className="px-6 py-3 text-muted-foreground">
                      {formatDate(row.updated_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Logs de IA</CardTitle>
          <CardDescription>Até 50 chamadas mais recentes.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-y bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-6 py-3 font-medium">Capability</th>
                <th className="px-6 py-3 font-medium">Modelo</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 text-right font-medium">Tokens</th>
                <th className="px-6 py-3 text-right font-medium">Custo</th>
                <th className="px-6 py-3 text-right font-medium">Latência</th>
                <th className="px-6 py-3 font-medium">Data</th>
              </tr>
            </thead>
            <tbody>
              {detail.aiLogs.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-6 py-6 text-center text-muted-foreground"
                  >
                    Nenhuma chamada de IA registrada.
                  </td>
                </tr>
              ) : (
                detail.aiLogs.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-6 py-3 font-medium">{row.capability}</td>
                    <td className="px-6 py-3 text-muted-foreground">
                      {row.model}
                    </td>
                    <td className="px-6 py-3">
                      <Badge variant="outline">{row.status}</Badge>
                    </td>
                    <td className="px-6 py-3 text-right text-muted-foreground">
                      {(row.tokens_in + row.tokens_out).toLocaleString("pt-BR")}
                    </td>
                    <td className="px-6 py-3 text-right text-muted-foreground">
                      {formatUsd(row.cost_usd)}
                    </td>
                    <td className="px-6 py-3 text-right text-muted-foreground">
                      {row.latency_ms} ms
                    </td>
                    <td className="px-6 py-3 text-muted-foreground">
                      {formatDate(row.created_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
