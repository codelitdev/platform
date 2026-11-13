/**
 * REST helpers for products that define their HTTP API as an oRPC contract.
 *
 * This module has no runtime dependency on oRPC. It works on the plain shapes
 * oRPC passes to its hooks, so `@codelitdev/platform` does not pin an oRPC
 * version for products.
 *
 * - `platformErrors()` declares platform error codes on a contract route.
 * - `encodePlatformErrorBody()` is the handler's `customErrorResponseBodyEncoder`.
 * - `platformErrorResponseBodySchema()` is the generator's
 *   `customErrorResponseBodySchema`, so the document matches the runtime body.
 * - `listOperationIds()` walks a contract for MCP parity and policy tables.
 * - `writeOpenApiDocument()` writes or checks the committed `openapi.json`.
 */
import {
  PLATFORM_ERROR_CODES,
  PLATFORM_ERROR_HTTP_STATUS,
  PLATFORM_ERROR_MESSAGES,
  type PlatformErrorCode,
  type PlatformSafeDetails,
  type PublicErrorBody,
} from "../errors.js";

export type PlatformErrorMap<C extends PlatformErrorCode> = {
  [K in C]: { status: number; message: string };
};

/** Error map entries for `oc.errors(...)`, keyed by platform error code. */
export function platformErrors<const C extends PlatformErrorCode>(
  ...codes: C[]
): PlatformErrorMap<C> {
  const map = {} as PlatformErrorMap<C>;
  for (const code of codes) {
    map[code] = {
      status: PLATFORM_ERROR_HTTP_STATUS[code],
      message: PLATFORM_ERROR_MESSAGES[code],
    };
  }
  return map;
}

export function isPlatformErrorCode(value: unknown): value is PlatformErrorCode {
  return (
    typeof value === "string" &&
    (PLATFORM_ERROR_CODES as readonly string[]).includes(value)
  );
}

/** True when `value` is a `{ code, message, details? }` platform error body. */
export function isPublicErrorBody(value: unknown): value is PublicErrorBody {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { code?: unknown; message?: unknown };
  return isPlatformErrorCode(candidate.code) && typeof candidate.message === "string";
}

/** The parts of an oRPC `ORPCError` that error encoding reads. */
export type RestErrorLike = {
  code: string;
  status: number;
  defined: boolean;
  data?: unknown;
};

const STATUS_FALLBACK_CODES: Record<number, PlatformErrorCode> = {
  400: "validation_failed",
  401: "unauthenticated",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  413: "validation_failed",
  415: "validation_failed",
  422: "validation_failed",
  429: "rate_limited",
};

function readDetails(data: unknown): PlatformSafeDetails | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const details = (data as { details?: unknown }).details;
  if (typeof details !== "object" || details === null) return undefined;
  return details as PlatformSafeDetails;
}

/**
 * Builds the HTTP error body for an oRPC error.
 *
 * - Platform codes become `{ code, message, details? }`, with the fixed public
 *   message. `data.details` is passed through as `details`.
 * - Other codes declared on the route (`defined: true`) return their `data`
 *   unchanged. Products use this for their own error bodies, for example a
 *   readiness report on 503.
 * - Anything else, such as oRPC input validation failures or thrown
 *   exceptions, becomes a platform body chosen from the status. It never
 *   includes internal messages.
 */
export function encodePlatformErrorBody(error: RestErrorLike): unknown {
  if (isPlatformErrorCode(error.code)) {
    const body: PublicErrorBody = {
      code: error.code,
      message: PLATFORM_ERROR_MESSAGES[error.code],
    };
    const details = readDetails(error.data);
    if (details) body.details = details;
    return body;
  }
  if (error.defined) return error.data;
  const code = STATUS_FALLBACK_CODES[error.status] ?? "internal_error";
  return { code, message: PLATFORM_ERROR_MESSAGES[code] } satisfies PublicErrorBody;
}

type JsonSchema = Record<string, unknown>;

/** oRPC passes `[code, defaultMessage, dataRequired, dataJsonSchema]`. */
export type DefinedErrorDefinition = [
  code: string,
  defaultMessage: string,
  dataRequired: boolean,
  dataSchema: unknown,
];

export function platformErrorBodyJsonSchema(
  codes: readonly PlatformErrorCode[] = PLATFORM_ERROR_CODES,
): JsonSchema {
  return {
    type: "object",
    properties: {
      code: { type: "string", enum: [...codes] },
      message: { type: "string" },
      details: {
        type: "object",
        additionalProperties: {
          anyOf: [
            { type: "string" },
            { type: "number" },
            { type: "boolean" },
            { type: "null" },
          ],
        },
      },
    },
    required: ["code", "message"],
  };
}

/**
 * Documents the body `encodePlatformErrorBody` sends for one status. Platform
 * codes share one schema with a `code` enum; other declared codes use their
 * data schema.
 */
export function platformErrorResponseBodySchema(
  definitions: readonly DefinedErrorDefinition[],
  _status: number,
): JsonSchema {
  const platformCodes = definitions.map(([code]) => code).filter(isPlatformErrorCode);
  const variants: JsonSchema[] = [];
  if (platformCodes.length > 0) {
    variants.push(platformErrorBodyJsonSchema(platformCodes));
  }
  for (const [code, , , dataSchema] of definitions) {
    if (isPlatformErrorCode(code)) continue;
    variants.push(
      typeof dataSchema === "object" && dataSchema !== null
        ? (dataSchema as JsonSchema)
        : {},
    );
  }
  if (variants.length === 1) return variants[0] as JsonSchema;
  return { oneOf: variants };
}

/** Walks a nested contract and returns dot-path ids, e.g. `notes.list`. */
export function listOperationIds(
  router: unknown,
  prefix: readonly string[] = [],
): string[] {
  if (typeof router !== "object" || router === null) return [];
  if ("~orpc" in router) return [prefix.join(".")];
  const ids: string[] = [];
  for (const [key, value] of Object.entries(router)) {
    ids.push(...listOperationIds(value, [...prefix, key]));
  }
  return ids;
}

const NO_BODY_STATUSES = new Set(["204", "205", "304"]);
const STATUS_DESCRIPTIONS: Record<string, string> = {
  "200": "OK",
  "201": "Created",
  "202": "Accepted",
  "204": "No Content",
  "400": "Bad Request",
  "401": "Unauthorized",
  "403": "Forbidden",
  "404": "Not Found",
  "409": "Conflict",
  "413": "Content Too Large",
  "422": "Unprocessable Content",
  "429": "Too Many Requests",
  "500": "Internal Server Error",
  "503": "Service Unavailable",
};

/**
 * Tidies a generated document in place and returns it: responses that cannot
 * carry a body (204, 205, 304) lose their content, and generic descriptions
 * ("OK" on a 201, "404" on a 404) become the HTTP status text.
 */
export function normalizeOpenApiDocument<T>(document: T): T {
  const paths = (document as { paths?: Record<string, Record<string, unknown>> }).paths;
  for (const operations of Object.values(paths ?? {})) {
    for (const operation of Object.values(operations)) {
      const responses = (operation as { responses?: Record<string, JsonSchema> })
        ?.responses;
      for (const [status, response] of Object.entries(responses ?? {})) {
        if (NO_BODY_STATUSES.has(status)) delete response.content;
        const text = STATUS_DESCRIPTIONS[status];
        if (
          text &&
          (response.description === status || response.description === "OK")
        ) {
          response.description = text;
        }
      }
    }
  }
  return document;
}

/** Stable text for a committed OpenAPI document: 2-space JSON plus newline. */
export function serializeOpenApiDocument(document: unknown): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export type OpenApiWriteResult = "written" | "current" | "stale" | "missing";

/**
 * Writes `document` to `file`, or with `check: true` compares without
 * writing. Check mode returns "stale" or "missing" so the caller can fail CI.
 */
export async function writeOpenApiDocument(input: {
  document: unknown;
  file: string;
  check?: boolean;
}): Promise<OpenApiWriteResult> {
  // Imported lazily so contract packages that browsers bundle can import
  // this module without pulling in node:fs.
  const { readFile, writeFile } = await import("node:fs/promises");
  const next = serializeOpenApiDocument(input.document);
  let current: string | undefined;
  try {
    current = await readFile(input.file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (current === next) return "current";
  if (input.check) return current === undefined ? "missing" : "stale";
  await writeFile(input.file, next);
  return "written";
}

/**
 * Body of a product's `generate:openapi` script. Pass `--check` to fail
 * (exit code 1) when the committed file differs from the contract.
 */
export async function runOpenApiScript(input: {
  document: unknown;
  file: string;
  argv?: readonly string[];
  log?: (line: string) => void;
}): Promise<OpenApiWriteResult> {
  const argv = input.argv ?? process.argv.slice(2);
  const log = input.log ?? ((line: string) => console.log(line));
  const result = await writeOpenApiDocument({
    document: input.document,
    file: input.file,
    check: argv.includes("--check"),
  });
  if (result === "stale" || result === "missing") {
    log(
      `${input.file} is ${result === "missing" ? "missing" : "out of date"}. Run \`bun run generate:openapi\` and commit the result.`,
    );
    process.exitCode = 1;
  } else {
    log(`${input.file} is ${result === "written" ? "updated" : "current"}.`);
  }
  return result;
}
