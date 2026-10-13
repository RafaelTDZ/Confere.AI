import type { AiProviderId } from "@/lib/ai/provider";
import { DEFAULT_FIREWORKS_MODEL } from "@/lib/ai/providers/fireworks-config";
import { DEFAULT_OPENROUTER_MODEL } from "@/lib/ai/providers/openrouter-model";

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
    ],
  },
  {
    id: "fireworks",
    name: "Fireworks",
    description:
      "Inferência serverless. GLM-5.3-Flash é multimodal (imagens, sem PDF direto).",
    models: [
      {
        id: DEFAULT_FIREWORKS_MODEL,
        label: "GLM-5.3-Flash",
        hint: "Padrão · multimodal · thinking nativo",
      },
      {
        id: "accounts/fireworks/models/glm-5p3",
        label: "GLM-5.3",
        hint: "Maior · texto (sem imagem)",
      },
    ],
  },
];
