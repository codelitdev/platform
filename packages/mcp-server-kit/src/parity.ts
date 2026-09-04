import { z } from "zod";

export const mcpParityEntrySchema = z.discriminatedUnion("parity", [
  z.object({
    capability: z.string().min(1),
    risk: z.enum(["read", "write", "destructive"]),
    rest: z.object({ operationId: z.string().min(1) }),
    mcp: z.object({ tool: z.string().min(1) }),
    parity: z.literal("required"),
  }),
  z.object({
    capability: z.string().min(1),
    rest: z.object({ operationId: z.string().min(1) }).optional(),
    mcp: z.object({ tool: z.string().min(1) }).optional(),
    parity: z.literal("exempt"),
    exemption: z.object({
      reason: z.string().min(1),
      owner: z.string().min(1),
      reviewBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
  }),
]);

export type McpParityEntry = z.infer<typeof mcpParityEntrySchema>;

export type ParityValidationIssue = {
  capability: string;
  reason: string;
};

export function validateParityManifest(
  entries: readonly unknown[],
  options: {
    restOperationIds: ReadonlySet<string>;
    mcpToolNames: ReadonlySet<string>;
    mcpToolRisks?: ReadonlyMap<string, "read" | "write" | "destructive">;
    now?: Date;
  },
): ParityValidationIssue[] {
  const issues: ParityValidationIssue[] = [];
  const now = options.now ?? new Date();
  const documentedRest = new Set<string>();
  for (const raw of entries) {
    const parsed = mcpParityEntrySchema.safeParse(raw);
    if (!parsed.success) {
      issues.push({
        capability: "unknown",
        reason: "invalid_entry",
      });
      continue;
    }
    const entry = parsed.data;
    if (entry.rest) {
      documentedRest.add(entry.rest.operationId);
      if (!options.restOperationIds.has(entry.rest.operationId)) {
        issues.push({
          capability: entry.capability,
          reason: "missing_rest_operation",
        });
      }
    }
    if (entry.mcp && !options.mcpToolNames.has(entry.mcp.tool)) {
      issues.push({ capability: entry.capability, reason: "missing_mcp_tool" });
    }
    if (entry.parity === "exempt") {
      const reviewBy = new Date(`${entry.exemption.reviewBy}T00:00:00.000Z`);
      if (reviewBy.getTime() <= now.getTime()) {
        issues.push({
          capability: entry.capability,
          reason: "exemption_expired",
        });
      }
      continue;
    }
    const actualRisk = options.mcpToolRisks?.get(entry.mcp.tool);
    if (options.mcpToolRisks && !actualRisk) {
      issues.push({
        capability: entry.capability,
        reason: "missing_mcp_risk",
      });
    } else if (actualRisk && actualRisk !== entry.risk) {
      issues.push({
        capability: entry.capability,
        reason: "mcp_risk_mismatch",
      });
    }
  }
  for (const operationId of options.restOperationIds) {
    if (!documentedRest.has(operationId)) {
      issues.push({
        capability: operationId,
        reason: "missing_rest_parity_entry",
      });
    }
  }
  return issues;
}
