import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Garante que o usuario autenticado tenha tenant.
 * Usado como fallback para contas antigas criadas antes do trigger de signup.
 */
export async function ensureUserTenant(
  supabase: SupabaseClient,
  fallbackName: string,
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Usuario nao autenticado");
  }

  if (user.app_metadata?.tenant_id) {
    return;
  }

  const name =
    (user.user_metadata?.full_name as string | undefined)?.trim() ||
    fallbackName.trim() ||
    user.email?.split("@")[0] ||
    "Minha empresa";

  const { error: tenantError } = await supabase.rpc("create_tenant_with_owner", {
    p_name: name,
  });

  // Conta ja pode ter sido provisionada por outra request/trigger.
  if (
    tenantError &&
    !tenantError.message.toLowerCase().includes("ja possui tenant")
  ) {
    throw tenantError;
  }

  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) throw refreshError;
}
