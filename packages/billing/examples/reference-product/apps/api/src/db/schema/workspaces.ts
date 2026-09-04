import { pgTable, text, uuid } from "drizzle-orm/pg-core";

export const workspaces = pgTable("workspaces", {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
});
