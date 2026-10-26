import { notFound } from "next/navigation";
import { CircleCheck, Package } from "lucide-react";
import { ConsigneeCheckCard } from "@/components/importacoes/consignee-check-card";
import { ImportacaoForm } from "@/components/importacoes/importacao-form";
import { BackButton } from "@/components/layout/back-button";
import { getAuthContext } from "@/lib/auth";
import {
  displayImportReference,
  getImportDetail,
  ImportNotFoundError,
} from "@/lib/documents";

export default async function ImportacaoDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ merged?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const auth = await getAuthContext();

  let detail;
  try {
    detail = await getImportDetail(auth.tenantId, id);
  } catch (error) {
    if (error instanceof ImportNotFoundError) notFound();
    throw error;
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <BackButton fallbackHref="/importacoes" />
      {query.merged === "ok" && (
        <p className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-foreground">
          <CircleCheck className="h-4 w-4 shrink-0 text-primary" />
          Documentos reunidos nesta importação.
        </p>
      )}
      <header className="space-y-1">
        <div className="flex items-center gap-2 text-primary">
          <Package className="h-4 w-4" />
          <span className="text-xs font-medium uppercase tracking-wide">
            Importações
          </span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          {displayImportReference(detail) || "Identificar importação"}
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Dados consolidados após a análise dos documentos desta operação.
        </p>
      </header>

      <ConsigneeCheckCard
        defaultConsignee={detail.defaultConsignee}
        documentConsignee={detail.documentConsignee}
        divergences={detail.consigneeDivergences}
      />

      <ImportacaoForm
        key={detail.id}
        detail={detail}
        canEdit={auth.role !== "viewer"}
      />
    </div>
  );
}
