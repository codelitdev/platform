export const mcpParityManifest = [
  {
    capability: "notes.list",
    risk: "read",
    rest: { operationId: "listNotes" },
    mcp: { tool: "notes.list" },
    parity: "required",
  },
  {
    capability: "notes.create",
    risk: "write",
    rest: { operationId: "createNote" },
    mcp: { tool: "notes.create" },
    parity: "required",
  },
  {
    capability: "notes.update",
    risk: "write",
    rest: { operationId: "updateNote" },
    mcp: { tool: "notes.update" },
    parity: "required",
  },
  {
    capability: "notes.delete",
    risk: "destructive",
    rest: { operationId: "deleteNote" },
    mcp: { tool: "notes.delete" },
    parity: "required",
  },
  {
    capability: "health",
    rest: { operationId: "health" },
    parity: "exempt",
    exemption: {
      reason: "Health is transport-specific and has no MCP tool.",
      owner: "platform",
      reviewBy: "2027-09-01",
    },
  },
  {
    capability: "ready",
    rest: { operationId: "ready" },
    parity: "exempt",
    exemption: {
      reason: "Readiness is transport-specific and has no MCP tool.",
      owner: "platform",
      reviewBy: "2027-09-01",
    },
  },
  {
    capability: "billing.entitlement",
    rest: { operationId: "getEntitlement" },
    parity: "exempt",
    exemption: {
      reason:
        "Billing entitlement remains REST-only in the reference vertical.",
      owner: "platform",
      reviewBy: "2027-09-01",
    },
  },
  {
    capability: "tenant.list",
    rest: { operationId: "listTenants" },
    parity: "exempt",
    exemption: {
      reason:
        "Tenant administration is account-scoped and REST-only in the reference vertical.",
      owner: "platform",
      reviewBy: "2027-09-01",
    },
  },
  {
    capability: "tenant.create",
    rest: { operationId: "createTenant" },
    parity: "exempt",
    exemption: {
      reason:
        "Tenant administration is account-scoped and REST-only in the reference vertical.",
      owner: "platform",
      reviewBy: "2027-09-01",
    },
  },
  {
    capability: "tenant.select",
    rest: { operationId: "selectTenant" },
    parity: "exempt",
    exemption: {
      reason:
        "Tenant selection persists browser account state and has no MCP equivalent.",
      owner: "platform",
      reviewBy: "2027-09-01",
    },
  },
  {
    capability: "api-key.list",
    rest: { operationId: "listApiKeys" },
    parity: "exempt",
    exemption: {
      reason:
        "Credential administration remains REST-only to avoid exposing secret-management flows over MCP.",
      owner: "platform",
      reviewBy: "2027-09-01",
    },
  },
  {
    capability: "api-key.create",
    rest: { operationId: "createApiKey" },
    parity: "exempt",
    exemption: {
      reason:
        "Credential administration remains REST-only to avoid exposing secret-management flows over MCP.",
      owner: "platform",
      reviewBy: "2027-09-01",
    },
  },
  {
    capability: "api-key.revoke",
    rest: { operationId: "revokeApiKey" },
    parity: "exempt",
    exemption: {
      reason:
        "Credential administration remains REST-only to avoid exposing secret-management flows over MCP.",
      owner: "platform",
      reviewBy: "2027-09-01",
    },
  },
  {
    capability: "invitation.create",
    rest: { operationId: "createInvitation" },
    parity: "exempt",
    exemption: {
      reason:
        "Invitation delivery is a browser and email workflow, not an MCP capability.",
      owner: "platform",
      reviewBy: "2027-09-01",
    },
  },
  {
    capability: "invitation.accept",
    rest: { operationId: "acceptInvitation" },
    parity: "exempt",
    exemption: {
      reason:
        "Invitation acceptance binds an authenticated browser identity and remains REST-only.",
      owner: "platform",
      reviewBy: "2027-09-01",
    },
  },
  {
    capability: "invitation.revoke",
    rest: { operationId: "revokeInvitation" },
    parity: "exempt",
    exemption: {
      reason:
        "Invitation administration remains REST-only in the reference vertical.",
      owner: "platform",
      reviewBy: "2027-09-01",
    },
  },
] as const;
