import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { MemberRole } from "@confere/domain";

export interface AuthContext {
  userId: string;
  email: string | null;
  tenantId: string;
  role: MemberRole;
}

export type AuthState =
  | { status: "unauthenticated" }
  | { status: "needs_onboarding"; userId: string; email: string | null }
  | { status: "authenticated"; context: AuthContext };

export class UnauthorizedError extends Error {
  constructor(message = "Nao autenticado") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class MissingTenantError extends Error {
  constructor() {
    super("Usuario sem tenant associado");
    this.name = "MissingTenantError";
  }
}

/**
 * Resolve o estado de autenticacao sem colapsar "sem tenant" em "logout".
 * tenant_id/role vem de app_metadata (hook ou raw_app_meta_data).
 */
export async function resolveAuthState(): Promise<AuthState> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { status: "unauthenticated" };
  }

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = (user.app_metadata?.tenant_role ?? "viewer") as MemberRole;

  if (!tenantId) {
    return {
      status: "needs_onboarding",
      userId: user.id,
      email: user.email ?? null,
    };
  }

  return {
    status: "authenticated",
    context: {
      userId: user.id,
      email: user.email ?? null,
      tenantId,
      role,
    },
  };
}

/**
 * Resolve o contexto de autenticacao a partir do JWT validado pelo Supabase.
 * tenant_id/role vem de app_metadata (injetados pelo custom access token hook).
 */
export async function getAuthContext(): Promise<AuthContext> {
  const state = await resolveAuthState();

  if (state.status === "unauthenticated") {
    throw new UnauthorizedError();
  }

  if (state.status === "needs_onboarding") {
    throw new MissingTenantError();
  }

  return state.context;
}

export async function getAuthContextOrNull(): Promise<AuthContext | null> {
  const state = await resolveAuthState();
  return state.status === "authenticated" ? state.context : null;
}
