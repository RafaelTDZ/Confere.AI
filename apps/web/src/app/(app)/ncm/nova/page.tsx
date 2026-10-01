import { Hash } from "lucide-react";
import { NcmForm } from "@/components/ncm/ncm-form";
import { BackButton } from "@/components/layout/back-button";
import { getAuthContext } from "@/lib/auth";

export default async function NcmNovaPage() {
  const auth = await getAuthContext();

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
        <h1 className="text-2xl font-bold tracking-tight">Cadastrar NCM</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Informe o código e a descrição para incluir no catálogo deste tenant.
        </p>
      </header>

      <NcmForm canEdit={auth.role !== "viewer"} />
    </div>
  );
}
