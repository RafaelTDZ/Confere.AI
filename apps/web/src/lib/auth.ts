import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { MemberRole } from "@confere/domain";

export interface AuthContext {
  userId: string;
  email: string | null;
  tenantId: string;
  role: MemberRole;
}

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
 * Resolve o contexto de autenticacao a partir do JWT validado pelo Supabase.
 * tenant_id/role vem de app_metadata (injetados pelo custom access token hook).
 */
export async function getAuthContext(): Promise<AuthContext> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new UnauthorizedError();
  }

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = (user.app_metadata?.tenant_role ?? "viewer") as MemberRole;

  if (!tenantId) {
    throw new MissingTenantError();
  }

  return {
    userId: user.id,
    email: user.email ?? null,
    tenantId,
    role,
  };
}

export async function getAuthContextOrNull(): Promise<AuthContext | null> {
  try {
    return await getAuthContext();
  } catch {
    return null;
  }
}
