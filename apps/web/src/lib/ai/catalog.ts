import type { AiProviderId } from "@/lib/ai/provider";
import { DEFAULT_OPENROUTER_MODEL } from "@/lib/ai/providers/openrouter-model";

export const MUSE_SPARK_OPENROUTER_MODEL = "meta/muse-spark-1.3";

export type ModelPreset = {
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
    id: "openrouter",
    name: "OpenRouter",
    description: "Gateway multi-modelos. Suporta PDF direto (file-parser).",
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
