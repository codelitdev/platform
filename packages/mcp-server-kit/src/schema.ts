import {
  fromJsonSchema,
  type JsonSchemaType,
  type StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * Advertise a product's Zod 3 tool schema as the JSON Schema object MCP
 * requires. Refs are inlined and `$schema` is dropped so clients read the
 * schema under MCP's default dialect (JSON Schema 2020-12).
 */
export function toMcpObjectSchema(
  schema: z.ZodType,
  kind: "input" | "output" = "input",
): StandardSchemaWithJSON {
  const { $schema: _dialect, ...json } = zodToJsonSchema(schema, {
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as Record<string, unknown>;
  if (json.type !== "object") {
    throw new Error(`MCP tool ${kind} schemas must describe an object`);
  }
  return fromJsonSchema(json as JsonSchemaType);
}

export function toMcpInputSchema(schema: z.ZodType): StandardSchemaWithJSON {
  return toMcpObjectSchema(schema, "input");
}
