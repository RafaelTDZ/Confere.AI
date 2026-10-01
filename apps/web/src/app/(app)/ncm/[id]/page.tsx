import { notFound } from "next/navigation";
import { Hash } from "lucide-react";
import { NcmForm } from "@/components/ncm/ncm-form";
import { BackButton } from "@/components/layout/back-button";
import { getAuthContext } from "@/lib/auth";
import { formatNcmCode, getNcmById, NcmNotFoundError } from "@/lib/documents";

export default async function NcmEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const auth = await getAuthContext();

  let ncm;
  try {
    ncm = await getNcmById(auth.tenantId, id);
  } catch (error) {
    if (error instanceof NcmNotFoundError) notFound();
    throw error;
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <BackButton fallbackHref="/ncm" />
      <header className="space-y-1">
        <div className="flex items-center gap-2 text-primary">
          <Hash className="h-4 w-4" />
          <span className="text-xs font-medium uppercase tracking-wide">
            NCM
          </span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          {formatNcmCode(ncm.code)}
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Confira e atualize o código e a descrição desta NCM.
        </p>
      </header>

      <NcmForm
        ncmId={ncm.id}
        code={ncm.code}
        description={ncm.description}
        canEdit={auth.role !== "viewer"}
      />
    </div>
  );
}
