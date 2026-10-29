import "server-only";

import type { AiProviderId } from "@/lib/ai/provider";
import { DEFAULT_FIREWORKS_MODEL } from "@/lib/ai/providers/fireworks-config";
import { DEFAULT_OPENROUTER_MODEL } from "@/lib/ai/providers/openrouter-model";

const GLM_FLASH_FIREWORKS_MODEL = "accounts/fireworks/routers/glm-flash-latest";
const DEEPSEEK_V4_FLASH_1017_FIREWORKS_MODEL =
  "accounts/fireworks/models/deepseek-v4p1-flash-1017";
const DEEPSEEK_V4_FLASH_FIREWORKS_MODEL =
  "accounts/fireworks/models/deepseek-v4p1-flash";
const MUSE_SPARK_OPENROUTER_MODEL = "meta/muse-spark-1.3";

type ModelPreset = {
  id: string;
  label: string;
  hint: string;
};

export type ProviderInfo = {
  id: AiProviderId;
  name: string;
  description: string;
  models: ModelPreset[];
};

export const AI_PROVIDER_CATALOG: ProviderInfo[] = [
  {
    id: "fireworks",
    name: "Fireworks",
    description:
      "Provider direto do Fireworks (padrão). PDF → imagens renderizadas no servidor.",
    models: [
      {
        id: DEEPSEEK_V4_FLASH_1017_FIREWORKS_MODEL,
        label: "DeepSeek V4.1 Flash 1017",
        hint: "Config atual · multimodal",
      },
      {
        id: DEEPSEEK_V4_FLASH_FIREWORKS_MODEL,
        label: "DeepSeek V4.1 Flash",
        hint: "Snapshot anterior",
      },
      {
        id: DEFAULT_FIREWORKS_MODEL,
        label: "DeepSeek Flash Latest (router)",
        hint: "Alias do servidor · multimodal",
      },
      {
        id: GLM_FLASH_FIREWORKS_MODEL,
        label: "GLM Flash Latest",
        hint: "Multimodal · thinking nativo",
      },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description:
      "Gateway multi-modelos. PDF direto (file-parser) com fallback mistral-ocr.",
    models: [
      {
        id: DEFAULT_OPENROUTER_MODEL,
        label: "GPT Luna Latest",
        hint: "Padrão do servidor",
      },
      {
        id: MUSE_SPARK_OPENROUTER_MODEL,
        label: "Muse Spark 1.3",
        hint: "Multimodal · reasoning nativo",
      },
    ],
  },
];
