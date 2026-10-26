import "server-only";

import { AiConfigError } from "@/lib/ai/config";

export const DEFAULT_FIREWORKS_MODEL =
  "accounts/fireworks/routers/deepseek-flash-latest";

export class FireworksConfigError extends AiConfigError {
  constructor(message: string) {
    super(message);
    this.name = "FireworksConfigError";
  }
}

export function getFireworksApiKey(): string {
  const apiKey = process.env.FIREWORKS_API_KEY?.trim();
  if (!apiKey) {
    throw new FireworksConfigError(
      "FIREWORKS_API_KEY não configurada. Defina a chave no .env da raiz (app.fireworks.ai/settings/api-keys).",
    );
  }
  return apiKey;
}

export function getFireworksModel(): string {
  return process.env.FIREWORKS_MODEL?.trim() || DEFAULT_FIREWORKS_MODEL;
}
