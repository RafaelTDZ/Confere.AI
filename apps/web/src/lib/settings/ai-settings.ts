import "server-only";

import { z } from "zod";
import { AI_PROVIDER_CATALOG } from "@/lib/ai/catalog";
import { isModelCompatibleWithProvider } from "@/lib/ai/model-compat";
import {
  getAiModelId,
  getAiProvider,
  normalizeOverrides,
  type AiOverrides,
  type AiProviderId,
} from "@/lib/ai/provider";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type { AiOverrides };

/** Chave única da linha de config de IA em app_settings. */
const AI_SETTINGS_KEY = "ai";

const INVALID_PROVIDER_MESSAGE = "Provedor inválido (use fireworks ou openrouter)";
const INVALID_MODEL_MESSAGE = "Modelo não pertence ao provedor selecionado";

function presetIdsFor(provider: AiProviderId): string[] {
  const entry = AI_PROVIDER_CATALOG.find((item) => item.id === provider);
  return entry ? entry.models.map((model) => model.id) : [];
}

const aiOverridesSchema = z
  .object({
    provider: z.enum(["fireworks", "openrouter"], {
      error: INVALID_PROVIDER_MESSAGE,
    }),
    model: z
      .string()
      .trim()
      .min(1, "Modelo é obrigatório")
      .max(200, "Modelo muito longo")
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.model) return;
    if (
      !isModelCompatibleWithProvider(
        value.provider,
        value.model,
        presetIdsFor(value.provider),
      )
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["model"],
        message: INVALID_MODEL_MESSAGE,
      });
    }
  });

export type AiSettingsInput = z.infer<typeof aiOverridesSchema>;

export type EffectiveAiConfig = {
  provider: AiProviderId;
  model: string;
  /** 'global' = definido pelo admin (vale para todos); 'env' = padrão do servidor. */
  source: "global" | "env";
};

/**
 * Allowlist de super-admins (emails separados por vírgula em ADMIN_EMAILS).
 * Só esses emails acessam /configuracoes e /api/settings/ai, independente
 * de tenant/role — todo signup vira owner do próprio tenant, então role
 * sozinha não restringe.
 */
function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isSuperAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowlist = getAdminEmails();
  return allowlist.length > 0 && allowlist.includes(email.trim().toLowerCase());
}

export function resolveEffectiveConfig(overrides: AiOverrides): EffectiveAiConfig {
  const clean = normalizeOverrides(overrides);
  const customized = Boolean(clean.provider || clean.model);
  return {
    provider: getAiProvider(clean),
    model: getAiModelId(clean),
    source: customized ? "global" : "env",
  };
}

type AppSettingsRow = {
  provider: string | null;
  model: string | null;
};

async function readGlobalRow(): Promise<AiOverrides> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("app_settings")
    .select("provider, model")
    .eq("key", AI_SETTINGS_KEY)
    .maybeSingle<AppSettingsRow>();

  if (error) {
    throw new Error(`Falha ao ler configurações de IA: ${error.message}`);
  }
  return normalizeOverrides({ provider: data?.provider, model: data?.model });
}

/** Lê a config global de IA ({} quando segue o padrão do servidor). */
export async function getAiOverrides(): Promise<AiOverrides> {
  return readGlobalRow();
}

/** Salva a config global de IA (vale para todos os usuários). */
export async function saveAiOverrides(
  input: AiSettingsInput,
  userId?: string,
): Promise<EffectiveAiConfig> {
  const parsed = aiOverridesSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const message = issue?.path.includes("provider")
      ? INVALID_PROVIDER_MESSAGE
      : (issue?.message ?? "Configuração de IA inválida");
    throw new Error(message);
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("app_settings").upsert(
    {
      key: AI_SETTINGS_KEY,
      provider: parsed.data.provider,
      model: parsed.data.model?.trim() || null,
      updated_by: userId ?? null,
    },
    { onConflict: "key" },
  );

  if (error) {
    throw new Error(`Falha ao salvar configurações de IA: ${error.message}`);
  }
  return resolveEffectiveConfig({
    provider: parsed.data.provider,
    model: parsed.data.model?.trim(),
  });
}

/** Remove a personalização global (volta ao padrão do servidor). */
export async function clearAiOverrides(): Promise<EffectiveAiConfig> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("app_settings")
    .update({ provider: null, model: null, updated_by: null })
    .eq("key", AI_SETTINGS_KEY);

  if (error) {
    throw new Error(`Falha ao redefinir configurações de IA: ${error.message}`);
  }
  return resolveEffectiveConfig({});
}

/** Chaves configuradas no servidor (só presença, nunca valores). */
export function getServerKeysStatus() {
  return {
    fireworksConfigured: Boolean(process.env.FIREWORKS_API_KEY?.trim()),
    openrouterConfigured: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
  };
}
