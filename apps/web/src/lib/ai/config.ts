export class AiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiConfigError";
  }
}

export class OpenRouterConfigError extends AiConfigError {
  constructor(message: string) {
    super(message);
    this.name = "OpenRouterConfigError";
  }
}

export function getOpenRouterApiKey(): string {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new OpenRouterConfigError(
      "OPENROUTER_API_KEY não configurada. Defina a chave no .env da raiz (openrouter.ai/settings/keys).",
    );
  }
  return apiKey;
}
