import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { imports } from "./imports.js";

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    importId: uuid("import_id")
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),
    docType: text("doc_type", {
      enum: ["invoice", "packing_list", "bill_of_lading"],
    }).notNull(),
    storagePath: text("storage_path").notNull(),
    sha256: text("sha256").notNull().default(""),
    version: integer("version").notNull().default(1),
    status: text("status", {
      enum: ["pending", "extracted", "failed"],
    })
      .notNull()
      .default("pending"),
    originalFilename: text("original_filename"),
    contentType: text("content_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("documents_import_type_version_key").on(
      table.importId,
      table.docType,
      table.version,
    ),
    index("documents_tenant_status_idx").on(table.tenantId, table.status),
    index("documents_sha256_idx").on(table.tenantId, table.sha256),
  ],
);

export const extractionResults = pgTable(
  "extraction_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    payload: jsonb("payload").notNull(),
    confidence: jsonb("confidence").notNull().default({}),
    tokensUsed: integer("tokens_used"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("extraction_results_document_idx").on(table.documentId),
    index("extraction_results_tenant_idx").on(table.tenantId),
  ],
);
