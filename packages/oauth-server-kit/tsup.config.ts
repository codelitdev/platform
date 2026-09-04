import { defineConfig, Options } from "tsup";

export default defineConfig((options: Options) => ({
  treeshake: true,
  entry: {
    index: "src/index.ts",
    "better-auth": "src/better-auth-entry.ts",
    express: "src/express-entry.ts",
    mcp: "src/mcp-entry.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  minify: false,
  clean: true,
  external: ["better-auth", "@better-auth/oauth-provider", "express"],
  ...options,
}));
