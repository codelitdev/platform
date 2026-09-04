import { describe, expect, it } from "vitest";
import { validateParityManifest } from "./parity.js";

describe("validateParityManifest", () => {
  it("requires REST operations and MCP tools for required entries", () => {
    const issues = validateParityManifest(
      [
        {
          capability: "notes.list",
          risk: "read",
          rest: { operationId: "listNotes" },
          mcp: { tool: "notes.list" },
          parity: "required",
        },
      ],
      {
        restOperationIds: new Set(["listNotes"]),
        mcpToolNames: new Set(["notes.list"]),
      },
    );
    expect(issues).toEqual([]);
    const missing = validateParityManifest(
      [
        {
          capability: "notes.list",
          risk: "read",
          rest: { operationId: "listNotes" },
          mcp: { tool: "notes.list" },
          parity: "required",
        },
      ],
      { restOperationIds: new Set(), mcpToolNames: new Set() },
    );
    expect(missing.map((issue) => issue.reason).sort()).toEqual([
      "missing_mcp_tool",
      "missing_rest_operation",
    ]);
  });

  it("fails expired exemptions", () => {
    const issues = validateParityManifest(
      [
        {
          capability: "health",
          parity: "exempt",
          exemption: {
            reason: "transport",
            owner: "platform",
            reviewBy: "2020-01-01",
          },
        },
      ],
      {
        restOperationIds: new Set(),
        mcpToolNames: new Set(),
        now: new Date("2026-09-02T00:00:00.000Z"),
      },
    );
    expect(issues).toEqual([
      { capability: "health", reason: "exemption_expired" },
    ]);
  });

  it("checks declared MCP risk against runtime tool metadata", () => {
    const issues = validateParityManifest(
      [
        {
          capability: "notes.delete",
          risk: "destructive",
          rest: { operationId: "deleteNote" },
          mcp: { tool: "notes.delete" },
          parity: "required",
        },
      ],
      {
        restOperationIds: new Set(["deleteNote"]),
        mcpToolNames: new Set(["notes.delete"]),
        mcpToolRisks: new Map([["notes.delete", "write"]]),
      },
    );
    expect(issues).toEqual([
      { capability: "notes.delete", reason: "mcp_risk_mismatch" },
    ]);
  });

  it("requires every REST operation to be required or explicitly exempt", () => {
    const issues = validateParityManifest([], {
      restOperationIds: new Set(["listNotes"]),
      mcpToolNames: new Set(),
    });
    expect(issues).toEqual([
      { capability: "listNotes", reason: "missing_rest_parity_entry" },
    ]);
  });
});
