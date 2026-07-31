import { NextResponse } from "next/server";
import { generateText } from "ai";
import {
  getDefaultLanguageModel,
  getOpenRouterModel,
  OpenRouterConfigError,
} from "@/lib/ai";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Smoke autenticado da integração OpenRouter.
 * GET /api/ai/health → { ok, model, text, latencyMs }
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

    const modelId = getOpenRouterModel();
    const started = Date.now();

    const { text } = await generateText({
      model: getDefaultLanguageModel(),
      prompt: 'Responda apenas com a palavra "ok".',
    });

    return NextResponse.json({
      ok: true,
      model: modelId,
      text: text.trim(),
      latencyMs: Date.now() - started,
    });
  } catch (error) {
    if (error instanceof OpenRouterConfigError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }

    console.error("[api/ai/health] OpenRouter error:", error);
    const message =
      error instanceof Error ? error.message : "Falha ao chamar OpenRouter";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
