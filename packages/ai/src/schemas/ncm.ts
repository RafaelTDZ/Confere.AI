import { z } from "zod";

export const ncmClassifyResultSchema = z.object({
  ncm: z.string().describe("Codigo NCM sugerido, 8 digitos, sem pontuacao"),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().describe("Justificativa curta em portugues"),
  alternatives: z
    .array(z.object({ ncm: z.string(), reasoning: z.string() }))
    .describe("Codigos alternativos quando houver duvida razoavel"),
  missingInfo: z
    .string()
    .nullable()
    .describe("Informacao que falta na descricao, quando confianca baixa"),
});

export type NcmClassifyResultSchema = z.infer<typeof ncmClassifyResultSchema>;
