import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

const MEMBER_ROLES = ["owner", "admin", "operator", "viewer"] as const;

/** Mesmo check de `tenant_members.role` no banco (init.sql). */
type MemberRole = (typeof MEMBER_ROLES)[number];

function toMemberRole(value: unknown): MemberRole {
  return MEMBER_ROLES.includes(value as MemberRole)
    ? (value as MemberRole)
    : "viewer";
}

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
  const role = toMemberRole(user.app_metadata?.tenant_role);

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
