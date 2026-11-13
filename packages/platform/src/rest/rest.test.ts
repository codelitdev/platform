import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  encodePlatformErrorBody,
  isPublicErrorBody,
  listOperationIds,
  normalizeOpenApiDocument,
  platformErrorResponseBodySchema,
  platformErrors,
  writeOpenApiDocument,
} from "./index.js";

describe("platformErrors", () => {
  it("maps codes to their platform status and public message", () => {
    expect(platformErrors("unauthenticated", "not_found")).toEqual({
      unauthenticated: { status: 401, message: "Authentication is required." },
      not_found: { status: 404, message: "The requested resource was not found." },
    });
  });
});

describe("encodePlatformErrorBody", () => {
  it("uses the fixed public message and passes safe details", () => {
    expect(
      encodePlatformErrorBody({
        code: "conflict",
        status: 409,
        defined: true,
        data: { details: { field: "title" } },
      }),
    ).toEqual({
      code: "conflict",
      message: "The request conflicts with current state.",
      details: { field: "title" },
    });
  });

  it("returns data unchanged for product-defined codes", () => {
    const report = { status: "not_ready", checks: { database: false } };
    expect(
      encodePlatformErrorBody({
        code: "not_ready",
        status: 503,
        defined: true,
        data: report,
      }),
    ).toBe(report);
  });

  it("maps undefined oRPC errors by status without leaking internals", () => {
    expect(
      encodePlatformErrorBody({
        code: "BAD_REQUEST",
        status: 400,
        defined: false,
        data: { issues: ["secret"] },
      }),
    ).toEqual({ code: "validation_failed", message: "The request is invalid." });
    expect(
      encodePlatformErrorBody({
        code: "INTERNAL_SERVER_ERROR",
        status: 500,
        defined: false,
      }),
    ).toEqual({ code: "internal_error", message: "An internal error occurred." });
    expect(
      encodePlatformErrorBody({
        code: "not_ready",
        status: 503,
        defined: false,
        data: {},
      }),
    ).toEqual({ code: "internal_error", message: "An internal error occurred." });
  });
});

describe("platformErrorResponseBodySchema", () => {
  it("documents platform codes as one schema with a code enum", () => {
    const schema = platformErrorResponseBodySchema(
      [
        ["forbidden", "x", false, undefined],
        ["tenant_forbidden", "x", false, undefined],
      ],
      403,
    );
    expect((schema.properties as { code: { enum: string[] } }).code.enum).toEqual([
      "forbidden",
      "tenant_forbidden",
    ]);
  });

  it("uses the data schema for product-defined codes", () => {
    const data = { type: "object", properties: { status: { const: "not_ready" } } };
    expect(platformErrorResponseBodySchema([["not_ready", "x", true, data]], 503)).toBe(
      data,
    );
  });
});

describe("listOperationIds", () => {
  it("returns dot paths for nested contract procedures", () => {
    const procedure = { "~orpc": {} };
    expect(
      listOperationIds({ health: procedure, settings: { esps: { list: procedure } } }),
    ).toEqual(["health", "settings.esps.list"]);
  });
});

describe("isPublicErrorBody", () => {
  it("accepts platform bodies only", () => {
    expect(isPublicErrorBody({ code: "not_found", message: "m" })).toBe(true);
    expect(isPublicErrorBody({ code: "nope", message: "m" })).toBe(false);
    expect(isPublicErrorBody({ error: "x" })).toBe(false);
  });
});

describe("normalizeOpenApiDocument", () => {
  it("drops 204 bodies and replaces generic descriptions", () => {
    const document = normalizeOpenApiDocument({
      paths: {
        "/x": {
          post: {
            responses: {
              "201": { description: "OK", content: {} },
              "204": { description: "OK", content: { "application/json": {} } },
              "404": { description: "404" },
              "503": { description: "Readiness report" },
            },
          },
        },
      },
    });
    expect(document.paths["/x"].post.responses).toEqual({
      "201": { description: "Created", content: {} },
      "204": { description: "No Content" },
      "404": { description: "Not Found" },
      "503": { description: "Readiness report" },
    } as never);
  });
});

describe("writeOpenApiDocument", () => {
  it("writes, then reports current, and check mode reports stale or missing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openapi-"));
    const file = path.join(dir, "openapi.json");
    expect(await writeOpenApiDocument({ document: { a: 1 }, file, check: true })).toBe(
      "missing",
    );
    expect(await writeOpenApiDocument({ document: { a: 1 }, file })).toBe("written");
    expect(await readFile(file, "utf8")).toBe('{\n  "a": 1\n}\n');
    expect(await writeOpenApiDocument({ document: { a: 1 }, file, check: true })).toBe(
      "current",
    );
    await writeFile(file, "{}\n");
    expect(await writeOpenApiDocument({ document: { a: 1 }, file, check: true })).toBe(
      "stale",
    );
    expect(await readFile(file, "utf8")).toBe("{}\n");
  });
});
