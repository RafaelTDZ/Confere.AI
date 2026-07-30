import { schema, type Database } from "@confere/database";
import type { UnitOfWorkRepositories } from "@confere/application";
import {
  DrizzleAILogRepository,
  DrizzleAnalysisRepository,
  DrizzleAuditRepository,
  DrizzleDocumentRepository,
  DrizzleExtractionRepository,
  DrizzleImportRepository,
  DrizzleProductMatchRepository,
  DrizzleProductRepository,
  DrizzleTenantSettingsRepository,
} from "./drizzle-repositories.js";

export interface Repositories extends UnitOfWorkRepositories {
  aiLogs: DrizzleAILogRepository;
  tenantSettings: DrizzleTenantSettingsRepository;
}

export function createRepositories(db: Database): Repositories {
  return {
    imports: new DrizzleImportRepository(db, schema),
    documents: new DrizzleDocumentRepository(db, schema),
    extractions: new DrizzleExtractionRepository(db, schema),
    analyses: new DrizzleAnalysisRepository(db, schema),
    products: new DrizzleProductRepository(db, schema),
    productMatches: new DrizzleProductMatchRepository(db, schema),
    audit: new DrizzleAuditRepository(db, schema),
    aiLogs: new DrizzleAILogRepository(db, schema),
    tenantSettings: new DrizzleTenantSettingsRepository(db, schema),
  };
}
