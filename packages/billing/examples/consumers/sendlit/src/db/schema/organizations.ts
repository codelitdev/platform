import { pgTable, text, uuid } from "drizzle-orm/pg-core";

/** SendLit billable entity. Product-owned; billing only stores a foreign key. */
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
});
