import { createDb } from "@confere/database";
import {
  createRepositories,
  getServiceClient,
  SupabaseFileStorage,
  PgBossPublisher,
  getBoss,
} from "@confere/infrastructure";
import {
  ApproveImport,
  ConfirmDocumentUpload,
  CreateImport,
  PrepareDocumentUpload,
  RejectImport,
} from "@confere/application";

/**
 * Container server-side (BFF): monta repositorios e casos de uso.
 * Toda operacao exige o tenant_id resolvido do JWT — nunca do cliente.
 */
export function getRepositories() {
  return createRepositories(createDb());
}

export function getUseCases() {
  const repos = getRepositories();
  const storage = new SupabaseFileStorage(getServiceClient());

  return {
    createImport: new CreateImport(repos.imports, repos.audit),
    prepareDocumentUpload: new PrepareDocumentUpload(
      repos.imports,
      repos.documents,
      storage,
      repos.audit,
    ),
    confirmDocumentUpload: new ConfirmDocumentUpload(repos.documents),
    approveImport: new ApproveImport(
      repos.imports,
      repos.products,
      repos.productMatches,
      repos.audit,
    ),
    rejectImport: new RejectImport(repos.imports, repos.audit),
    repos,
    storage,
  };
}

export async function enqueueProcessImport(input: {
  importId: string;
  tenantId: string;
}): Promise<void> {
  const boss = await getBoss();
  const publisher = new PgBossPublisher(boss);
  await publisher.enqueue(
    "process-import",
    { importId: input.importId, tenantId: input.tenantId },
    { singletonKey: `process-import:${input.importId}`, retryLimit: 3 },
  );
}
