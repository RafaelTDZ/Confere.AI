import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { getAuthContext, type AuthContext } from "@/lib/auth";
import { ApplicationError } from "@confere/application";
import type { MemberRole } from "@confere/domain";

export function jsonError(status: number, message: string, code?: string) {
  return NextResponse.json({ error: { message, code } }, { status });
}

export function handleRouteError(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return jsonError(
      422,
      error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      "VALIDATION",
    );
  }
  if (error instanceof ApplicationError) {
    const status =
      error.code === "NOT_FOUND"
        ? 404
        : error.code === "FORBIDDEN"
          ? 403
          : error.code === "CONFLICT"
            ? 409
            : 422;
    return jsonError(status, error.message, error.code);
  }
  if (error instanceof Error && error.name === "UnauthorizedError") {
    return jsonError(401, error.message, "UNAUTHORIZED");
  }
  if (error instanceof Error && error.name === "MissingTenantError") {
    return jsonError(403, error.message, "NO_TENANT");
  }
  console.error("[api] erro nao tratado:", error);
  return jsonError(500, "Erro interno", "INTERNAL");
}

const WRITE_ROLES: MemberRole[] = ["owner", "admin", "operator"];

/** Guard padrao das rotas autenticadas. */
export async function requireAuth(options?: {
  write?: boolean;
}): Promise<AuthContext | NextResponse> {
  try {
    const ctx = await getAuthContext();
    if (options?.write && !WRITE_ROLES.includes(ctx.role)) {
      return jsonError(403, "Papel sem permissao de escrita", "FORBIDDEN");
    }
    return ctx;
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function parseBody<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T> {
  const body = await request.json();
  return schema.parse(body);
}
