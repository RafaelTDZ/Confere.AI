import { redirect } from "next/navigation";
import { Settings } from "lucide-react";
import { resolveAuthState } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/settings/ai-settings";
import { AiSettingsForm } from "@/components/configuracoes/ai-settings-form";

export default async function ConfiguracoesPage() {
  const state = await resolveAuthState();
  if (state.status !== "authenticated") redirect("/login");
  if (!isSuperAdmin(state.context.email)) redirect("/analise");

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-primary">
          <Settings className="h-4 w-4" />
          Administração
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Provedor e modelo de IA para todos os usuários. Vale para
          classificação, extração e novas análises.
        </p>
      </div>

      <AiSettingsForm />
    </div>
  );
}
