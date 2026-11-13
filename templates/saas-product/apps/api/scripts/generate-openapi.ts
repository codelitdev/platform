// Writes the committed apps/api/openapi.json from the API contract.
// `--check` fails instead of writing; CI runs it on every change, and the
// release version step runs it without `--check` so each release commits the
// document hosted docs serve.
import path from "node:path";
import { runOpenApiScript } from "@codelitdev/platform/rest";
import { createOpenApiDocument } from "../src/openapi.js";

await runOpenApiScript({
  document: await createOpenApiDocument(),
  file: path.resolve(import.meta.dirname, "../openapi.json"),
});
