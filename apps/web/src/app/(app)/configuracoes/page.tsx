import Link from "next/link";
import { redirect } from "next/navigation";
import { Settings } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AiSettingsForm } from "@/components/configuracoes/ai-settings-form";
import { DefaultConsigneeForm } from "@/components/empresas/default-consignee-form";
import { getAuthContext } from "@/lib/auth";
import {
  formatAddressLine,
  formatCnpj,
  type ConsigneeDefault,
} from "@/lib/documents";
import {
  getDefaultConsignee,
  listTenantPartyOptions,
  type TenantPartyOption,
} from "@/lib/documents/consignee-settings";
import { isSuperAdmin } from "@/lib/settings/ai-settings";

export default async function ConfiguracoesPage() {
  const auth = await getAuthContext();
  const superAdmin = isSuperAdmin(auth.email);
  const canManageConsignee = auth.role === "owner" || auth.role === "admin";

  if (!superAdmin) redirect("/analise");

  let defaultConsignee: ConsigneeDefault | null = null;
  let partyOptions: TenantPartyOption[] = [];
  let consigneeError: string | null = null;

  if (canManageConsignee) {
    try {
      [defaultConsignee, partyOptions] = await Promise.all([
        getDefaultConsignee(auth.tenantId),
        listTenantPartyOptions(auth.tenantId),
      ]);
    } catch (error) {
      consigneeError = error instanceof Error ? error.message : String(error);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-primary">
          <Settings className="h-4 w-4" />
          Administração
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Consignee padrão do tenant e provedor/modelo de IA para todos os
          usuários. Visível apenas para super-admin.
        </p>
      </div>

      {canManageConsignee && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">Consignee padrão</CardTitle>
              <Badge variant="secondary">
                Vale para todas as importações
              </Badge>
            </div>
            <CardDescription>
              O consignee padrão é vinculado automaticamente a todas as
              importações; o documento é comparado e as divergências aparecem na
              importação. O notify continua sendo cadastrado por documento.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {consigneeError ? (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive-text">
                Não foi possível carregar o consignee padrão: {consigneeError}
              </p>
            ) : (
              <>
                {defaultConsignee ? (
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      {defaultConsignee.name}
                    </p>
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
                      Editar cadastro em Empresas
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
                  canEdit={canManageConsignee}
                />
              </>
            )}
          </CardContent>
        </Card>
      )}

      {superAdmin && <AiSettingsForm />}
    </div>
  );
}
