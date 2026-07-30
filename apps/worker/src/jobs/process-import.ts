import { createDocumentAI, type CreateDocumentAIOptions } from "@confere/ai";
import {
  ProcessImport,
  type ProcessImportJobData,
  type ProcessImportResult,
} from "@confere/application";
import { createDb } from "@confere/database";
import {
  createRepositories,
  getServiceClient,
  SupabaseFileStorage,
} from "@confere/infrastructure";

/**
 * Job principal: executa o pipeline completo de uma importacao
 * (extracao -> comparacao -> matching -> awaiting_review).
 */
export async function processImportJob(
  data: ProcessImportJobData,
): Promise<ProcessImportResult> {
  const db = createDb();
  const repos = createRepositories(db);

  const settings = await repos.tenantSettings.get(data.tenantId);
  const modelOverrides: CreateDocumentAIOptions["modelOverrides"] =
    Object.fromEntries(
      Object.entries(settings?.aiOverrides ?? {}).map(([capability, value]) => [
        capability,
        { provider: value.provider, model: value.model },
      ]),
    ) as CreateDocumentAIOptions["modelOverrides"];

  const useCase = new ProcessImport({
    imports: repos.imports,
    documents: repos.documents,
    extractions: repos.extractions,
    analyses: repos.analyses,
    products: repos.products,
    productMatches: repos.productMatches,
    aiLogs: repos.aiLogs,
    storage: new SupabaseFileStorage(getServiceClient()),
    documentAI: createDocumentAI({ modelOverrides }),
  });

  return useCase.execute({
    importId: data.importId,
    tenantId: data.tenantId,
  });
}
