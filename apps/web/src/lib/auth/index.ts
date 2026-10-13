import { createSupabaseServerClient } from "@/lib/supabase/server";

export type MemberRole = "owner" | "admin" | "member" | "viewer";

export interface AuthContext {
  userId: string;
  email: string | null;
  tenantId: string;
  role: MemberRole;
}

export type AuthState =
  | { status: "unauthenticated" }
  | { status: "authenticated"; context: AuthContext };

export class UnauthorizedError extends Error {
  constructor(message = "Nao autenticado") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Resolve o estado de autenticacao a partir do JWT.
 * tenant_id/role vem de app_metadata (trigger de signup / hook).
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
    return { status: "unauthenticated" };
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
 */
export async function getAuthContext(): Promise<AuthContext> {
  const state = await resolveAuthState();

  if (state.status === "unauthenticated") {
    throw new UnauthorizedError();
  }

  return state.context;
}
