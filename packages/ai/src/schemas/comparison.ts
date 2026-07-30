import { z } from "zod";

export const findingSchema = z.object({
  field: z.string().describe("Campo divergente (ex: item_quantity:SKU-123)"),
  message: z.string().describe("Descricao clara da divergencia em portugues"),
  severity: z.enum(["info", "warning", "critical"]),
  expected: z.union([z.string(), z.number()]).nullable().optional(),
  actual: z.union([z.string(), z.number()]).nullable().optional(),
  suggestion: z
    .string()
    .nullable()
    .optional()
    .describe("Sugestao pratica de correcao para o usuario"),
});

export const comparisonResultSchema = z.object({
  findings: z.array(findingSchema),
});

export type ComparisonResultSchema = z.infer<typeof comparisonResultSchema>;
