import { NextResponse } from "next/server";
import { z } from "zod";
import { getUseCases } from "@/lib/container";
import { handleRouteError, parseBody, requireAuth } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { repos } = getUseCases();
    const settings = await repos.tenantSettings.get(ctx.tenantId);
    return NextResponse.json({ data: settings });
  } catch (error) {
    return handleRouteError(error);
  }
}

const updateSettingsSchema = z.object({
  confidenceThreshold: z.number().min(0).max(1).optional(),
});

export async function PATCH(request: Request) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;
  if (ctx.role !== "owner" && ctx.role !== "admin") {
    return NextResponse.json(
      { error: { message: "Somente owner/admin", code: "FORBIDDEN" } },
      { status: 403 },
    );
  }

  try {
    const input = await parseBody(request, updateSettingsSchema);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("tenant_settings")
      .update({
        ...(input.confidenceThreshold !== undefined
          ? { confidence_threshold: input.confidenceThreshold }
          : {}),
      })
      .eq("tenant_id", ctx.tenantId);
    if (error) throw new Error(error.message);

    return NextResponse.json({ data: { updated: true } });
  } catch (error) {
    return handleRouteError(error);
  }
}
