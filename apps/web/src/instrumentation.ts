import { registerOTel } from "@vercel/otel";

/**
 * Registra o OpenTelemetry no runtime do Next.
 * Na Vercel os traces vão para a observabilidade do projeto; localmente vira
 * no-op (a menos que `OTEL_EXPORTER_OTLP_ENDPOINT` esteja definido).
 */
export function register() {
  registerOTel({ serviceName: "confere-web" });
}
