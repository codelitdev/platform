import { describe, expect, it } from "bun:test";
import { createCipheriv, randomBytes } from "node:crypto";
import {
  BillingConfigurationError,
  BillingWorkflowError,
} from "@codelitdev/billing/core";
import { frozenClock } from "../clock.js";
import {
  billingErrorResponse,
  billingWebhookPath,
  createAesGcmSensitiveValues,
  createBillingActionGrants,
  createReturnUrlValidator,
  handleBillingWebhook,
  MemoryActionGrantStore,
  startBillingWorkers,
} from "./index.js";

const now = new Date("2026-06-01T12:00:00.000Z");
const target = { kind: "user", id: "user_1" };

function grants(options: { recentAuthMaxAgeMs?: number } = {}) {
  return createBillingActionGrants({
    store: new MemoryActionGrantStore(),
    clock: frozenClock(now),
    ...options,
  });
}

describe("billing action grants", () => {
  it("issues a token that works once for its action and target", async () => {
    const g = grants();
    const issued = await g.issue({
      actorId: "user_1",
      sessionId: "session_1",
      sessionCreatedAt: now,
      action: "cancellation",
      target,
    });
    if (!issued.ok) throw new Error("expected a token");
    const grant = g.grant({
      token: issued.token,
      actorId: "user_1",
      sessionId: "session_1",
      action: "cancellation",
      target,
    });
    await expect(
      g.authorization.consume(grant, "cancellation", target, now),
    ).resolves.toBeUndefined();
    await expect(
      g.authorization.consume(grant, "cancellation", target, now),
    ).rejects.toThrow(BillingWorkflowError);
  });

  it("rejects a token used for another action, target, person, or session", async () => {
    const cases = [
      { action: "checkout" as const },
      { target: { kind: "user", id: "user_2" } },
      { actorId: "user_2" },
      { sessionId: "session_2" },
    ];
    for (const change of cases) {
      const g = grants();
      const issued = await g.issue({
        actorId: "user_1",
        sessionId: "session_1",
        sessionCreatedAt: now,
        action: "cancellation",
        target,
      });
      if (!issued.ok) throw new Error("expected a token");
      const grant = g.grant({
        token: issued.token,
        actorId: change.actorId ?? "user_1",
        sessionId: change.sessionId ?? "session_1",
        action: "cancellation",
        target,
      });
      await expect(
        g.authorization.consume(
          grant,
          change.action ?? "cancellation",
          change.target ?? target,
          now,
        ),
      ).rejects.toMatchObject({ code: "grant_invalid" });
    }
  });

  it("requires a recent sign-in and rejects expired tokens", async () => {
    const g = grants({ recentAuthMaxAgeMs: 60_000 });
    const stale = await g.issue({
      actorId: "user_1",
      sessionId: "session_1",
      sessionCreatedAt: new Date(now.getTime() - 120_000),
      action: "checkout",
      target,
    });
    expect(stale).toEqual({ ok: false, error: "recent_authentication_required" });

    const issued = await g.issue({
      actorId: "user_1",
      sessionId: "session_1",
      sessionCreatedAt: now,
      action: "checkout",
      target,
    });
    if (!issued.ok) throw new Error("expected a token");
    const grant = g.grant({
      token: issued.token,
      actorId: "user_1",
      sessionId: "session_1",
      action: "checkout",
      target,
    });
    await expect(
      g.authorization.consume(
        grant,
        "checkout",
        target,
        new Date(issued.expiresAt.getTime() + 1),
      ),
    ).rejects.toMatchObject({ code: "grant_invalid" });
  });
});

describe("AES-GCM sensitive values", () => {
  const key = randomBytes(32).toString("base64");

  it("round-trips and reads values encrypted with a previous key", async () => {
    const values = createAesGcmSensitiveValues({ key });
    const { ciphertext, keyVersion } = await values.encrypt(
      "https://pay.example/session",
    );
    expect(keyVersion).toBe("v1");
    const context = { operatorActorId: "user_1", reason: "test" };
    await expect(values.decrypt(ciphertext, context)).resolves.toBe(
      "https://pay.example/session",
    );
    const rotated = createAesGcmSensitiveValues({
      key: randomBytes(32).toString("base64"),
      previousKeys: [key],
    });
    await expect(rotated.decrypt(ciphertext, context)).resolves.toBe(
      "https://pay.example/session",
    );
  });

  it("reads the iv.tag.ciphertext format products already store", async () => {
    const raw = Buffer.from(key, "base64");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", raw, iv);
    const body = Buffer.concat([cipher.update("stored value", "utf8"), cipher.final()]);
    const legacy = [iv, cipher.getAuthTag(), body]
      .map((part) => part.toString("base64"))
      .join(".");
    await expect(
      createAesGcmSensitiveValues({ key }).decrypt(legacy, {
        operatorActorId: "user_1",
        reason: "test",
      }),
    ).resolves.toBe("stored value");
  });

  it("rejects keys that are not 32 base64 bytes", () => {
    expect(() => createAesGcmSensitiveValues({ key: "short" })).toThrow();
  });
});

describe("return URL validator", () => {
  it("accepts only the allowed origins", () => {
    const allowed = createReturnUrlValidator(["https://app.example.com/"]);
    expect(allowed("https://app.example.com/account/billing")).toBe(true);
    expect(allowed("https://evil.example.com/account/billing")).toBe(false);
    expect(allowed("javascript:alert(1)")).toBe(false);
    expect(allowed("not a url")).toBe(false);
  });
});

describe("billing webhook handler", () => {
  const headers = { "Webhook-Id": "evt_1", "webhook-signature": ["v1,abc"] };

  it("accepts, normalises headers, and reports duplicates", async () => {
    let seen: Record<string, string> = {};
    let drained = 0;
    const billing = {
      async ingestWebhook(input: { raw: { headers: Record<string, string> } }) {
        seen = input.raw.headers;
        return { duplicate: drained > 0, envelope: {} as never };
      },
      async runWebhookInboxBatch() {
        drained += 1;
        return 1;
      },
    };
    const first = await handleBillingWebhook({
      billing: billing as never,
      provider: "dodo",
      rawBody: Buffer.from("{}"),
      headers,
    });
    expect(first).toEqual({ status: 202, body: { accepted: true } });
    expect(seen).toEqual({ "webhook-id": "evt_1", "webhook-signature": "v1,abc" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await handleBillingWebhook({
      billing: billing as never,
      provider: "dodo",
      rawBody: "{}",
      headers,
    });
    expect(second.status).toBe(200);
    expect(billingWebhookPath("dodo")).toBe("/webhooks/billing/dodo");
  });

  it("rejects unverified or missing bodies and reports missing billing", async () => {
    const failing = {
      async ingestWebhook() {
        throw new Error("webhook_signature_invalid");
      },
      async runWebhookInboxBatch() {
        return 0;
      },
    };
    expect(
      (
        await handleBillingWebhook({
          billing: failing as never,
          provider: "dodo",
          rawBody: "{}",
          headers,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await handleBillingWebhook({
          billing: failing as never,
          provider: "dodo",
          rawBody: undefined,
          headers,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await handleBillingWebhook({
          billing: null,
          provider: "dodo",
          rawBody: "{}",
          headers,
        })
      ).status,
    ).toBe(503);
  });
});

describe("billing error response", () => {
  it("exposes only stable codes", () => {
    expect(billingErrorResponse(new BillingWorkflowError("checkout_pending"))).toEqual({
      status: 409,
      body: { error: "checkout_pending" },
    });
    expect(billingErrorResponse(new BillingWorkflowError("grant_invalid")).status).toBe(
      403,
    );
    expect(
      billingErrorResponse(new BillingWorkflowError("provider_unavailable")),
    ).toEqual({
      status: 503,
      body: { error: "provider_unavailable", retryable: true },
    });
    expect(billingErrorResponse(new BillingConfigurationError("x" as never))).toEqual({
      status: 503,
      body: { error: "billing_not_configured" },
    });
    expect(billingErrorResponse(new Error("Dodo said: secret detail"))).toEqual({
      status: 502,
      body: { error: "billing_request_failed" },
    });
  });
});

describe("billing workers", () => {
  it("runs every batch, reports failures, and stops", async () => {
    const calls: string[] = [];
    const errors: string[] = [];
    const billing = {
      recordRequestedCatalog: async () => void calls.push("record"),
      verifyRequestedCatalog: async () => void calls.push("verify"),
      runWebhookInboxBatch: async () => void calls.push("webhooks"),
      runReconciliationBatch: async () => {
        calls.push("reconcile");
        throw new Error("provider down");
      },
      runDeadlineBatch: async () => void calls.push("deadlines"),
      purgeExpiredSensitiveValues: async () => void calls.push("retention"),
    };
    const workers = startBillingWorkers({
      billing: billing as never,
      workerId: "test-worker",
      intervalMs: 5,
      retentionIntervalMs: 5,
      onError: (task) => errors.push(task),
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    await workers.stop();
    for (const name of [
      "record",
      "verify",
      "webhooks",
      "reconcile",
      "deadlines",
      "retention",
    ]) {
      expect(calls).toContain(name);
    }
    expect(errors).toContain("reconciliation");
    const count = calls.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls.length).toBe(count);
  });
});
