import { NextResponse } from "next/server";
import { getUseCases } from "@/lib/container";
import { handleRouteError, requireAuth } from "@/lib/api";

export async function GET(request: Request) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { searchParams } = new URL(request.url);
    const entity = searchParams.get("entity") ?? undefined;
    const { repos } = getUseCases();
    const logs = await repos.audit.listByTenant(ctx.tenantId, {
      entity,
      limit: 100,
    });
    return NextResponse.json({ data: logs });
  } catch (error) {
    return handleRouteError(error);
  }
}
