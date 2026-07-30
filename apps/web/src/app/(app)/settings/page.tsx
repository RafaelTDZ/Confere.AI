import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  const ctx = await getAuthContext().catch(() => null);
  if (!ctx) redirect("/onboarding");

  const supabase = await createSupabaseServerClient();
  const { data: settings } = await supabase
    .from("tenant_settings")
    .select("validation_rules, ai_overrides, confidence_threshold")
    .eq("tenant_id", ctx.tenantId)
    .single();

  const canEdit = ctx.role === "owner" || ctx.role === "admin";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Configuracoes</h1>
        <p className="text-sm text-muted-foreground">
          Preferencias do tenant e do comportamento da IA{" "}
          <Badge variant="secondary">{ctx.role}</Badge>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Analise de IA</CardTitle>
          <CardDescription>
            Limiar de confianca abaixo do qual a revisao humana e obrigatoria
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsForm
            confidenceThreshold={Number(
              settings?.confidence_threshold ?? 0.7,
            )}
            disabled={!canEdit}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Modelos por funcao</CardTitle>
          <CardDescription>
            Overrides de provider/model por capability (edicao avancada —
            disponivel na versao 2.0)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md bg-muted p-4 text-xs">
            {JSON.stringify(settings?.ai_overrides ?? {}, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
