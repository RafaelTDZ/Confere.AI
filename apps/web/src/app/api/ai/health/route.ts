import { NextResponse } from "next/server";
import { generateText } from "ai";
import {
  AiConfigError,
  getAiModelId,
  getAiProvider,
  getDefaultLanguageModel,
} from "@/lib/ai";
import { getAiOverrides } from "@/lib/settings/ai-settings";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthContext, UnauthorizedError } from "@/lib/auth";

/**
 * Smoke autenticado da integração de IA (config efetiva do tenant).
 * GET /api/ai/health → { ok, provider, model, source, text, latencyMs }
 */
export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: "Usuário não autenticado" },
        { status: 401 },
      );
    }

    // Garante usuário autenticado com tenant; config de IA é global.
    await getAuthContext();
    const overrides = await getAiOverrides();
    const provider = getAiProvider(overrides);
    const modelId = getAiModelId(overrides);
    const started = Date.now();

    const { text } = await generateText({
      model: getDefaultLanguageModel(overrides),
      prompt: 'Responda apenas com a palavra "ok".',
    });

    return NextResponse.json({
      ok: true,
      provider,
      model: modelId,
      source: overrides.provider || overrides.model ? "global" : "env",
      text: text.trim(),
      latencyMs: Date.now() - started,
    });
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

    console.error("[api/ai/health] AI error:", error);
    const message =
      error instanceof Error ? error.message : "Falha ao chamar o provider de IA";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
