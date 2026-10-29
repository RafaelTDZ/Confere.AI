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
import { consumeRateLimit } from "@/lib/security/rate-limit";

/** Cada GET gasta tokens de verdade: teto baixo por tenant, janela de 1h. */
const HEALTH_RATE_LIMIT = 20;
const HEALTH_RATE_WINDOW_SECONDS = 60 * 60;

/**
 * Smoke autenticado da integração de IA (config efetiva do tenant).
 * GET /api/ai/health → { ok, provider, model, source, text, latencyMs }
 *
 * Não grava `ai_logs` (endpoint de diagnóstico não entra na quota mensal de
 * tokens); o consumo é limitado pelo rate limit por tenant.
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
    const auth = await getAuthContext();
    const overrides = await getAiOverrides();
    const provider = getAiProvider(overrides);
    const modelId = getAiModelId(overrides);
    // Resolve o modelo antes do rate limit: sem chave o endpoint responde 503
    // sem consumir uma unidade do bucket.
    const model = getDefaultLanguageModel(overrides);

    try {
      const rateLimit = await consumeRateLimit({
        bucket: `ai:health:${auth.tenantId}`,
        limit: HEALTH_RATE_LIMIT,
        windowSeconds: HEALTH_RATE_WINDOW_SECONDS,
      });

      if (!rateLimit.allowed) {
        return NextResponse.json(
          {
            error:
              "Muitos testes de IA em pouco tempo. Tente novamente mais tarde.",
            retryAfterSeconds: rateLimit.retryAfterSeconds,
          },
          {
            status: 429,
            headers: {
              "Retry-After": String(rateLimit.retryAfterSeconds),
            },
          },
        );
      }
    } catch (error) {
      // Fail-open: indisponibilidade do rate limiter não derruba o diagnóstico.
      console.error("[api/ai/health] rate limit indisponível", error);
    }

    const started = Date.now();

    const { text } = await generateText({
      model,
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
