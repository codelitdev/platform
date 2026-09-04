import { pgTable, text, uuid } from "drizzle-orm/pg-core";

/** CourseLit billable entity. One payer may fund several independently billed schools. */
export const schools = pgTable("schools", {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
});
