import {
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    description: text("description").notNull(),
    ncm: text("ncm"),
    unitWeight: numeric("unit_weight"),
    unitOfMeasure: text("unit_of_measure"),
    attributes: jsonb("attributes").notNull().default({}),
    origin: text("origin", { enum: ["manual", "ai"] })
      .notNull()
      .default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("products_tenant_sku_key").on(table.tenantId, table.sku),
    index("products_tenant_description_idx").on(
      table.tenantId,
      table.description,
    ),
  ],
);
