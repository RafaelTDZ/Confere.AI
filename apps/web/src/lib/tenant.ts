import type { SupabaseClient } from "@supabase/supabase-js";

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; error_description?: unknown };
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message;
    }
    if (
      typeof record.error_description === "string" &&
      record.error_description.trim()
    ) {
      return record.error_description;
    }
  }
  return fallback;
}

/**
 * Garante que o usuario autenticado tenha tenant.
 * Usado como fallback para contas antigas / JWT ainda sem claim.
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

  // Conta ja pode ter sido provisionada pelo trigger de signup.
  if (
    tenantError &&
    !tenantError.message.toLowerCase().includes("ja possui tenant")
  ) {
    throw new Error(errorMessage(tenantError, "Falha ao provisionar empresa"));
  }

  const { data: refreshed, error: refreshError } =
    await supabase.auth.refreshSession();
  if (refreshError) {
    throw new Error(errorMessage(refreshError, "Falha ao atualizar sessao"));
  }

  if (!refreshed.session?.user?.app_metadata?.tenant_id) {
    // Releitura apos o update do trigger/RPC.
    const {
      data: { user: latest },
    } = await supabase.auth.getUser();
    if (!latest?.app_metadata?.tenant_id) {
      throw new Error("Conta criada, mas a empresa ainda nao foi associada. Tente entrar novamente.");
    }
  }
}

export function toUserFacingError(error: unknown, fallback: string): string {
  return errorMessage(error, fallback);
}
