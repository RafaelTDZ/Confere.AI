import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { BackButton } from "@/components/layout/back-button";
import { ManualTrackingEventForm } from "@/components/tracking/manual-event-form";
import { Notice } from "@/components/ui/notice";
import { getAuthContext } from "@/lib/auth";
import {
  getTrackingShipmentDetail,
  TrackingShipmentNotFoundError,
} from "@/lib/tracking/detail";

export const dynamic = "force-dynamic";

/**
 * Tela de evento manual do rastreio (`/rastreio/<shipmentId>/evento`).
 *
 * Fica fora do detalhe para o formulário não competir com o cabeçalho e o
 * histórico. O shipment é carregado só para exibir o contexto (processo, BL e
 * navio) e validar que ele pertence ao tenant.
 */
export default async function RastreioEventoPage({
  params,
}: {
  params: Promise<{ shipmentId: string }>;
}) {
  const { shipmentId } = await params;
  const auth = await getAuthContext();

  let detail;
  try {
    detail = await getTrackingShipmentDetail({
      tenantId: auth.tenantId,
      shipmentId,
    });
  } catch (error) {
    if (error instanceof TrackingShipmentNotFoundError) notFound();
    throw error;
  }

  const { shipment, import: importInfo } = detail;
  const backHref = `/rastreio/${shipmentId}`;
  const processHref = importInfo ? `/importacoes/${importInfo.id}` : backHref;
  const canEdit = auth.role !== "viewer";
  const context = [
    importInfo?.reference,
    importInfo?.blNumber ? `BL ${importInfo.blNumber}` : null,
    shipment.carrier,
    shipment.vessel ? `Navio ${shipment.vessel}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <BackButton fallbackHref={processHref} alwaysPush />

      <header className="space-y-1">
        <div className="flex items-center gap-2 text-primary">
          <Plus className="h-4 w-4" />
          <span className="text-xs font-medium uppercase tracking-wide">
            Rastreio
          </span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          Lançar evento manual
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {context || "Rastreio do embarque"}
        </p>
      </header>

      {canEdit ? (
        <ManualTrackingEventForm
          importId={shipment.importId}
          cancelHref={processHref}
          afterSaveHref={backHref}
        />
      ) : (
        <Notice tone="warning" title="Sem permissão para lançar eventos">
          <p>
            O perfil viewer acompanha o histórico, mas não pode lançar eventos
            manuais. Peça a um owner, admin ou operator do tenant.
          </p>
        </Notice>
      )}
    </div>
  );
}
