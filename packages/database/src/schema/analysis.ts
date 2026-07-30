import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { imports } from "./imports.js";
import { products } from "./products.js";

export const analysisResults = pgTable(
  "analysis_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    importId: uuid("import_id")
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),
    analysisType: text("analysis_type", {
      enum: ["comparison", "product_match", "validation"],
    }).notNull(),
    findings: jsonb("findings").notNull().default([]),
    severity: text("severity", { enum: ["info", "warning", "critical"] })
      .notNull()
      .default("info"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("analysis_results_import_idx").on(table.importId),
    index("analysis_results_tenant_idx").on(table.tenantId),
  ],
);

export const productMatches = pgTable(
  "product_matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    importId: uuid("import_id")
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    extractedData: jsonb("extracted_data").notNull(),
    matchStatus: text("match_status", {
      enum: ["new", "existing_match", "divergent"],
    }).notNull(),
    differences: jsonb("differences").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("product_matches_import_idx").on(table.importId),
    index("product_matches_product_idx").on(table.productId),
  ],
);
