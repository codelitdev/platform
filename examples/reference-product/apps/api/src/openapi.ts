import {
  normalizeOpenApiDocument,
  platformErrorResponseBodySchema,
} from "@codelitdev/platform/rest";
import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { contract } from "@reference-product/api-contract";
import packageJson from "../package.json" with { type: "json" };

/**
 * The server URL written into the committed `openapi.json`. Hosted docs serve
 * that file, so it names the production API, not the local one.
 */
export const OPENAPI_PUBLIC_SERVER_URL = "https://api.reference-product.example";

const generator = new OpenAPIGenerator({
  schemaConverters: [new ZodToJsonSchemaConverter()],
});

/**
 * Builds the OpenAPI document from the contract alone, without starting the
 * server, so release scripts can generate it.
 */
export async function createOpenApiDocument(
  serverUrl: string = OPENAPI_PUBLIC_SERVER_URL,
) {
  const document = await generator.generate(contract, {
    info: {
      title: "Reference Product API",
      version: packageJson.version,
    },
    servers: [{ url: serverUrl }],
    customErrorResponseBodySchema: platformErrorResponseBodySchema,
  });
  return normalizeOpenApiDocument(document);
}
