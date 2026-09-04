import { describe, expect, it } from "bun:test";
import * as betterAuthEntry from "./better-auth-entry";
import * as expressEntry from "./express-entry";
import * as root from "./index";
import * as mcpEntry from "./mcp-entry";

describe("public API", () => {
  it("keeps the root runtime dependency surface minimal", () => {
    expect(Object.keys(root).sort()).toEqual(["verifyOAuthAccessToken"]);
  });

  it("exports only the documented Better Auth helpers", () => {
    expect(Object.keys(betterAuthEntry).sort()).toEqual([
      "createOAuthProviderOptions",
      "resolveBetterAuthSession",
    ]);
  });

  it("exports only the documented Express helpers", () => {
    expect(Object.keys(expressEntry).sort()).toEqual([
      "createOAuthBearerMiddleware",
      "createOAuthPagesRouter",
    ]);
  });

  it("exports only the documented MCP helper", () => {
    expect(Object.keys(mcpEntry)).toEqual(["createMcpOAuthDiscoveryRoutes"]);
  });

  it("does not expose removed product or persistence APIs", () => {
    const all = {
      ...root,
      ...betterAuthEntry,
      ...expressEntry,
      ...mcpEntry,
    } as Record<string, unknown>;
    for (const removed of [
      "createCentralAuthResolver",
      "createCentralAuthMiddleware",
      "createOAuthTeamSelectionHooks",
      "oauthTeamSelection",
      "authUser",
      "authSession",
      "resolveApiKey",
    ]) {
      expect(all).not.toHaveProperty(removed);
    }
  });
});
