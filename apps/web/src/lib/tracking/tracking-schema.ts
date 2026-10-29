import "server-only";

/** JSON schema/prompt usados pelo Firecrawl para extrair o rastreio. */

const eventSchema = {
  type: "object",
  properties: {
    date: {
      type: "string",
      description:
        "Data/hora do evento como aparece na página (ISO 8601 se possível, senão DD/MM/AAAA).",
    },
    location: {
      type: ["string", "null"],
      description: "Porto, terminal ou cidade do evento.",
    },
    description: {
      type: "string",
      description: "Descrição do evento como exibida (ex.: Gate out, Loaded, Discharged).",
    },
  },
  required: ["date", "description"],
} as const;

export const TRACKING_JSON_SCHEMA = {
  type: "object",
  properties: {
    found: {
      type: "boolean",
      description:
        "true se a página exibiu resultados de rastreio para o número consultado.",
    },
    carrier: { type: ["string", "null"] },
    vessel: { type: ["string", "null"] },
    voyage: { type: ["string", "null"] },
    eta: {
      type: ["string", "null"],
      description: "ETA em ISO 8601 (YYYY-MM-DD) quando disponível.",
    },
    pol: { type: ["string", "null"], description: "Porto de origem." },
    pod: { type: ["string", "null"], description: "Porto de destino." },
    containers: {
      type: "array",
      description: "Containers e seus eventos de rastreio.",
      items: {
        type: "object",
        properties: {
          number: { type: "string", description: "Número ISO do container." },
          status: {
            type: ["string", "null"],
            description: "Status atual do container, como exibido.",
          },
          events: { type: "array", items: eventSchema },
        },
        required: ["number", "events"],
      },
    },
    notes: {
      type: ["string", "null"],
      description:
        "Observações relevantes (ex.: captcha, acesso negado, número não encontrado).",
    },
  },
  required: ["found", "containers"],
} as const;

export const TRACKING_JSON_PROMPT = [
  "Extraia o rastreio de embarque exibido na página do armador.",
  "Considere todos os containers e todos os eventos visíveis.",
  "Para vessel/voyage use o navio oceânico do cabeçalho do rastreio;",
  "não use o navio citado dentro da descrição de um evento (feeder).",
  "Preencha pol, pod e eta quando estiverem na página.",
  "Marque found=true se houver qualquer container ou evento visível,",
  "mesmo que uma mensagem de erro de busca anterior também apareça.",
  "Se não houver nenhum evento e a página disser que o número não foi encontrado,",
  "marque found=false e explique em notes.",
  "Não invente eventos: use apenas o que está visível.",
].join(" ");
