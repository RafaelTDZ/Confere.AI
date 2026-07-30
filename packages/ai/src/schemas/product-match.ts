import { z } from "zod";

export const productMatchResultSchema = z.object({
  decision: z
    .enum(["new", "existing", "uncertain"])
    .describe(
      "new: nao corresponde a nenhum candidato; existing: corresponde a um candidato; uncertain: duvida, exige revisao humana",
    ),
  productId: z
    .string()
    .nullable()
    .describe("ID do produto candidato escolhido, quando existing/uncertain"),
  reasoning: z
    .string()
    .describe("Justificativa curta da decisao em portugues"),
});

export type ProductMatchResultSchema = z.infer<typeof productMatchResultSchema>;
