import { describe, expect, it } from "bun:test";
import express from "express";
import { withHttpServer } from "../test/http";
import {
  createClientIpMiddleware,
  DEFAULT_TRUST_PROXY,
  parseTrustProxy,
} from "./client-ip";

describe("parseTrustProxy", () => {
  it("defaults to private networks", () => {
    expect(parseTrustProxy()).toBe(DEFAULT_TRUST_PROXY);
    expect(parseTrustProxy("  ")).toBe("loopback, linklocal, uniquelocal");
  });
  it("parses booleans, hop counts and address lists", () => {
    expect(parseTrustProxy("true")).toBe(true);
    expect(parseTrustProxy("false")).toBe(false);
    expect(parseTrustProxy("2")).toBe(2);
    expect(parseTrustProxy("10.0.0.0/8, 192.168.1.1")).toBe("10.0.0.0/8, 192.168.1.1");
  });
});

async function resolved(trust: string | undefined, headers: Record<string, string>) {
  const app = express();
  app.set("trust proxy", parseTrustProxy(trust));
  app.use(createClientIpMiddleware({ header: "X-Client-IP" }));
  app.get("/", (req, res) => {
    res.json({ header: req.headers["x-client-ip"] });
  });
  return withHttpServer(app, async (baseUrl) => {
    const res = await fetch(baseUrl, { headers });
    return (await res.json()) as { header: string };
  });
}

describe("createClientIpMiddleware", () => {
  it("rejects an empty header name", () => {
    expect(() => createClientIpMiddleware({ header: " " })).toThrow("header");
  });
  it("ignores a spoofed leftmost X-Forwarded-For entry", async () => {
    const honest = await resolved(undefined, { "x-forwarded-for": "203.0.113.9" });
    const spoofed = await resolved(undefined, {
      "x-forwarded-for": "6.6.6.6, 203.0.113.9",
    });
    expect(honest.header).toBe("203.0.113.9");
    expect(spoofed.header).toBe("203.0.113.9");
  });
  it("skips trusted private hops from the right", async () => {
    const r = await resolved(undefined, {
      "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.1.2.3",
    });
    expect(r.header).toBe("203.0.113.9");
  });
  it("overwrites a client-sent header", async () => {
    const r = await resolved(undefined, {
      "x-client-ip": "6.6.6.6",
      "x-forwarded-for": "203.0.113.9",
    });
    expect(r.header).toBe("203.0.113.9");
  });
  it("uses the peer address when proxies are not trusted", async () => {
    const r = await resolved("false", { "x-forwarded-for": "203.0.113.9" });
    expect(r.header).toMatch(/127\.0\.0\.1/);
  });
});
