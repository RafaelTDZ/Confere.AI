import { notFound, redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { PartesForm } from "@/components/analise/partes-form";
import { ConsigneeCheckCard } from "@/components/importacoes/consignee-check-card";
import { BackButton } from "@/components/layout/back-button";
import { getAuthContext } from "@/lib/auth";
import {
  getImportPartiesState,
  ImportNotFoundError,
} from "@/lib/documents";

export default async function PartesPage({
  params,
}: {
  params: Promise<{ importId: string }>;
}) {
  const { importId } = await params;
  const auth = await getAuthContext();

  let state;
  try {
    state = await getImportPartiesState(auth.tenantId, importId);
  } catch (error) {
    if (error instanceof ImportNotFoundError) notFound();
    throw error;
  }

  if (state.pendingParties.length === 0) {
    redirect(`/importacoes/${importId}`);
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <BackButton fallbackHref="/analise" />
      <header className="space-y-1">
        <div className="flex items-center gap-2 text-primary">
          <Building2 className="h-4 w-4" />
          <span className="text-xs font-medium uppercase tracking-wide">
            Cadastro de partes
          </span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          Consignee e Notify
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Confirme nome, CNPJ e endereço das empresas identificadas nos
          documentos que ainda não estão cadastradas neste tenant.
        </p>
      </header>

      <ConsigneeCheckCard
        defaultConsignee={state.defaultConsignee}
        documentConsignee={state.documentConsignee}
        divergences={state.consigneeDivergences}
      />

      <PartesForm
        importId={importId}
        pendingParties={state.pendingParties}
      />
    </div>
  );
}
