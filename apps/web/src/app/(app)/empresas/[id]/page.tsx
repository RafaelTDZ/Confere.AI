import { notFound } from "next/navigation";
import { Building2 } from "lucide-react";
import { EmpresaEditForm } from "@/components/empresas/empresa-edit-form";
import { BackButton } from "@/components/layout/back-button";
import { getAuthContext } from "@/lib/auth";
import { getPartyById, PartyNotFoundError } from "@/lib/documents";

export default async function EmpresaEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const auth = await getAuthContext();

  let party;
  try {
    party = await getPartyById(auth.tenantId, id);
  } catch (error) {
    if (error instanceof PartyNotFoundError) notFound();
    throw error;
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <BackButton fallbackHref="/empresas" />
      <header className="space-y-1">
        <div className="flex items-center gap-2 text-primary">
          <Building2 className="h-4 w-4" />
          <span className="text-xs font-medium uppercase tracking-wide">
            Empresas
          </span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{party.name}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Confira e atualize os dados cadastrados desta empresa.
        </p>
      </header>

      <EmpresaEditForm
        partyId={party.id}
        name={party.name}
        cnpj={party.cnpj}
        address={party.address}
        canEdit={auth.role !== "viewer"}
      />
    </div>
  );
}
