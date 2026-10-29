import { notFound } from "next/navigation";
import { ImportacaoForm } from "@/components/importacoes/importacao-form";
import { Notice } from "@/components/ui/notice";
import { BackButton } from "@/components/layout/back-button";
import { getAuthContext } from "@/lib/auth";
import {
  displayImportReference,
  getImportDetail,
  ImportNotFoundError,
} from "@/lib/documents";
import { getImportAiFailures } from "@/lib/documents/ai-logs";
import { getPrimaryTrackingShipmentId } from "@/lib/tracking/service";

const FAILURE_LABELS: Record<string, string> = {
  classify: "Classificação",
  extract_invoice: "Invoice",
  extract_packing_list: "Packing List",
  extract_bl: "Bill of Lading",
};

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

  const primaryShipmentId = await getPrimaryTrackingShipmentId({
    tenantId: auth.tenantId,
    importId: id,
  });
  // O botão (dentro do card "Dados do BL") abre direto o detalhe do
  // shipment principal; sem rastreio na importação, cai para a lista escopada.
  const trackingHref = primaryShipmentId
    ? `/rastreio/${primaryShipmentId}`
    : `/rastreio?import=${detail.id}`;
  const failures = await getImportAiFailures({
    tenantId: auth.tenantId,
    importId: id,
  });

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="flex min-w-0 items-center gap-2">
        <BackButton
          fallbackHref="/importacoes"
          className="size-11 sm:size-9"
        />
        <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight text-balance">
          {displayImportReference(detail) || "Identificar importação"}
        </h1>
      </header>

      {query.merged === "ok" && (
        <Notice tone="success">Documentos reunidos nesta importação.</Notice>
      )}

      {failures.length > 0 && (
        <Notice
          tone="warning"
          title="A IA não conseguiu extrair todos os documentos"
        >
          <ul className="list-disc space-y-1 pl-5">
            {failures.map((failure) => (
              <li key={`${failure.capability}-${failure.createdAt}`}>
                <span className="font-medium">
                  {FAILURE_LABELS[failure.capability] ?? failure.capability}:
                </span>{" "}
                {failure.message}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs">
            Os demais documentos desta importação foram extraídos normalmente.
            Reenvie o arquivo para tentar de novo.
          </p>
        </Notice>
      )}

      <ImportacaoForm
        key={detail.id}
        detail={detail}
        canEdit={auth.role !== "viewer"}
        trackingHref={trackingHref}
      />
    </div>
  );
}
