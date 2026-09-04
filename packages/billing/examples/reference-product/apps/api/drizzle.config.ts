import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    schema: [
        path.join(root, "src/db/schema/auth.ts"),
        path.join(root, "src/db/schema/workspaces.ts"),
        path.join(root, "src/db/schema/billing.generated.ts"),
    ],
    out:
        path.relative(process.cwd(), path.join(root, "src/db/migrations")) ||
        ".",
    dialect: "postgresql",
});
