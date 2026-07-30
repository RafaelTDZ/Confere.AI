import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const imports = pgTable(
  "imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    referenceNumber: text("reference_number").notNull(),
    status: text("status", {
      enum: [
        "uploaded",
        "processing",
        "awaiting_review",
        "completed",
        "rejected",
      ],
    })
      .notNull()
      .default("uploaded"),
    supplierName: text("supplier_name"),
    incoterm: text("incoterm"),
    currency: text("currency"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("imports_tenant_status_idx").on(table.tenantId, table.status),
    index("imports_tenant_created_idx").on(table.tenantId, table.createdAt),
  ],
);
