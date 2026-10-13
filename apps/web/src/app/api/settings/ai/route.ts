import { NextResponse } from "next/server";
import { AiConfigError } from "@/lib/ai";
import { AI_PROVIDER_CATALOG } from "@/lib/ai/catalog";
import {
  clearAiOverrides,
  getAiOverrides,
  getServerKeysStatus,
  isSuperAdmin,
  resolveEffectiveConfig,
  saveAiOverrides,
} from "@/lib/settings/ai-settings";
import { getAuthContext, UnauthorizedError } from "@/lib/auth";

async function requireAdmin() {
  const auth = await getAuthContext();
  if (!isSuperAdmin(auth.email)) {
    return { error: "Acesso restrito a administradores" as const };
  }
  return { auth };
}

function payload() {
  return getAiOverrides().then((overrides) => ({
    overrides,
    config: resolveEffectiveConfig(overrides),
    keys: getServerKeysStatus(),
    catalog: AI_PROVIDER_CATALOG,
  }));
}

/** Config global de IA (apenas super-admin). */
export async function GET() {
  try {
    const gate = await requireAdmin();
    if ("error" in gate) {
      return NextResponse.json({ error: gate.error }, { status: 403 });
    }
    return NextResponse.json(await payload());
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: "Usuário não autenticado" },
        { status: 401 },
      );
    }
    if (error instanceof AiConfigError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("[api/settings/ai] GET error:", error);
    return NextResponse.json(
      { error: "Falha ao carregar configurações de IA" },
      { status: 500 },
    );
  }
}

/** Salva provider/modelo global (apenas super-admin; vale para todos). */
export async function PUT(request: Request) {
  try {
    const gate = await requireAdmin();
    if ("error" in gate) {
      return NextResponse.json({ error: gate.error }, { status: 403 });
    }
    const body = (await request.json().catch(() => null)) as {
      provider?: unknown;
      model?: unknown;
    } | null;

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Corpo inválido" }, { status: 400 });
    }

    const config = await saveAiOverrides(
      {
        provider: body.provider as "openrouter" | "fireworks",
        model: typeof body.model === "string" ? body.model : undefined,
      },
      gate.auth.userId,
    );
    return NextResponse.json({
      ...(await payload()),
      config,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: "Usuário não autenticado" },
        { status: 401 },
      );
    }
    console.error("[api/settings/ai] PUT error:", error);
    const message =
      error instanceof Error ? error.message : "Falha ao salvar configurações";
    const status = /obrigatório|inválid|longo/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

/** Remove a personalização (volta ao padrão do servidor). */
export async function DELETE() {
  try {
    const gate = await requireAdmin();
    if ("error" in gate) {
      return NextResponse.json({ error: gate.error }, { status: 403 });
    }
    await clearAiOverrides();
    return NextResponse.json(await payload());
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: "Usuário não autenticado" },
        { status: 401 },
      );
    }
    console.error("[api/settings/ai] DELETE error:", error);
    return NextResponse.json(
      { error: "Falha ao redefinir configurações" },
      { status: 500 },
    );
  }
}
