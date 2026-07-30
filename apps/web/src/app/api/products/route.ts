import { NextResponse } from "next/server";
import { getUseCases } from "@/lib/container";
import { handleRouteError, requireAuth } from "@/lib/api";

export async function GET(request: Request) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") ?? undefined;
    const { repos } = getUseCases();
    const products = await repos.products.listByTenant(ctx.tenantId, {
      query,
      limit: 100,
    });
    return NextResponse.json({ data: products });
  } catch (error) {
    return handleRouteError(error);
  }
}
