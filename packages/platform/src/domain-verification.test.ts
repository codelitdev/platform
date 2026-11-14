import { describe, expect, it } from "bun:test";
import {
  createDnsResolver,
  createDomainVerification,
  type DnsResolver,
  isApexHostname,
  issueOwnershipToken,
  normalizeHostname,
} from "./domain-verification.js";

type Zone = {
  txt?: Record<string, string[][]>;
  cname?: Record<string, string[]>;
  a?: Record<string, string[]>;
  fail?: "timeout";
};

function fakeResolver(zone: Zone): DnsResolver {
  const lookup = async <T>(table: Record<string, T> | undefined, name: string) => {
    if (zone.fail === "timeout") throw new Error("dns_lookup_timeout");
    const value = table?.[name];
    if (value === undefined)
      throw Object.assign(new Error("ENODATA"), { code: "ENODATA" });
    return value;
  };
  return {
    resolveTxt: (name) => lookup(zone.txt, name),
    resolveCname: (name) => lookup(zone.cname, name),
    resolve4: (name) => lookup(zone.a, name),
  };
}

const verification = (zone: Zone) =>
  createDomainVerification({ label: "_test-verify", resolver: fakeResolver(zone) });

describe("ownership", () => {
  it("builds a TXT record whose value is the bare token", () => {
    expect(verification({}).ownershipRecord("example.com", "abc")).toEqual({
      type: "TXT",
      name: "_test-verify.example.com",
      value: "abc",
    });
  });

  it("issues 16-byte hex tokens", () => {
    const token = issueOwnershipToken();
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(issueOwnershipToken()).not.toBe(token);
  });

  it("matches and mismatches", async () => {
    const v = verification({
      txt: { "_test-verify.example.com": [["other"], ["tok"]] },
    });
    expect(await v.verifyOwnership("example.com", "tok")).toBe(true);
    expect(await v.verifyOwnership("example.com", "nope")).toBe(false);
    expect(await v.verifyOwnership("example.com", "")).toBe(false);
    expect(await v.verifyOwnership("missing.com", "tok")).toBe(false);
  });

  it("joins chunks and trims", async () => {
    const v = verification({
      txt: { "_test-verify.example.com": [["ab", "cd "]] },
    });
    expect(await v.verifyOwnership("example.com", "abcd")).toBe(true);
  });

  it("rejects substring matches", async () => {
    const v = verification({
      txt: { "_test-verify.example.com": [["tok-and-more"]] },
    });
    expect(await v.verifyOwnership("example.com", "tok")).toBe(false);
  });

  it("is false on DNS errors and timeouts", async () => {
    expect(
      await verification({ fail: "timeout" }).verifyOwnership("example.com", "tok"),
    ).toBe(false);
  });
});

describe("routing", () => {
  const target = { cnameTarget: "edge.platform.test" };

  it("accepts a direct CNAME, ignoring case and trailing dot", async () => {
    const v = verification({ cname: { "www.example.com": ["Edge.Platform.test."] } });
    expect(await v.verifyRouting("www.example.com", target)).toBe(true);
    expect(
      await v.verifyRouting("www.example.com", { cnameTarget: "EDGE.platform.test." }),
    ).toBe(true);
  });

  it("follows chains", async () => {
    const v = verification({
      cname: {
        "www.example.com": ["a.cdn.test"],
        "a.cdn.test": ["b.cdn.test"],
        "b.cdn.test": ["edge.platform.test"],
      },
    });
    expect(await v.verifyRouting("www.example.com", target)).toBe(true);
  });

  it("stops on loops and dead ends", async () => {
    const loop = verification({
      cname: { "www.example.com": ["a.test"], "a.test": ["www.example.com"] },
    });
    expect(await loop.verifyRouting("www.example.com", target)).toBe(false);
    const wrong = verification({ cname: { "www.example.com": ["elsewhere.test"] } });
    expect(await wrong.verifyRouting("www.example.com", target)).toBe(false);
  });

  it("does not use A records for non-apex hosts", async () => {
    const v = verification({ a: { "www.example.com": ["1.1.1.1"] } });
    expect(await v.verifyRouting("www.example.com", target)).toBe(false);
  });

  it("apex: CNAME flattening works without aRecords", async () => {
    const flattened = verification({ a: { "example.com": ["9.9.9.9"] } });
    expect(await flattened.verifyRouting("example.com", target)).toBe(true);
    const cname = verification({ cname: { "example.com": ["edge.platform.test"] } });
    expect(await cname.verifyRouting("example.com", target)).toBe(true);
    expect(await verification({}).verifyRouting("example.com", target)).toBe(false);
  });

  it("apex: A records must equal the configured set", async () => {
    const v = verification({ a: { "example.com": ["2.2.2.2", "1.1.1.1"] } });
    expect(
      await v.verifyRouting("example.com", {
        ...target,
        aRecords: ["1.1.1.1", "2.2.2.2"],
      }),
    ).toBe(true);
    expect(
      await v.verifyRouting("example.com", { ...target, aRecords: ["1.1.1.1"] }),
    ).toBe(false);
    expect(
      await v.verifyRouting("example.com", {
        ...target,
        aRecords: ["1.1.1.1", "3.3.3.3"],
      }),
    ).toBe(false);
  });

  it("apex under a multi-part suffix is treated as an apex", async () => {
    const v = verification({ a: { "example.co.uk": ["1.1.1.1"] } });
    expect(await v.verifyRouting("example.co.uk", target)).toBe(true);
  });

  it("is false on timeouts", async () => {
    expect(
      await verification({ fail: "timeout" }).verifyRouting("example.com", target),
    ).toBe(false);
  });
});

describe("normalizeHostname", () => {
  it.each([
    ["Example.COM", "example.com"],
    ["example.com.", "example.com"],
    ["  www.Example.com  ", "www.example.com"],
    ["https://example.com", "example.com"],
    ["https://example.com/", "example.com"],
    ["bücher.example", "xn--bcher-kva.example"],
    ["münchen.de", "xn--mnchen-3ya.de"],
    ["docs.example.co.uk", "docs.example.co.uk"],
  ])("accepts %s", (input, expected) => {
    expect(normalizeHostname(input)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "localhost",
    "example.com:8080",
    "example.com/path",
    "example.com?x=1",
    "example.com#frag",
    "user@example.com",
    "user:pw@example.com",
    "exa mple.com",
    "-bad.example.com",
    "bad-.example.com",
    "a..example.com",
    ".example.com",
    "exa_mple.com",
    "exa%6dple.com",
    `${"a".repeat(64)}.example.com`,
    `${"a.".repeat(130)}com`,
  ])("rejects %p", (input) => {
    expect(normalizeHostname(input)).toBeNull();
  });

  it("rejects IP literals unless allowed", () => {
    expect(normalizeHostname("127.0.0.1")).toBeNull();
    expect(normalizeHostname("0x7f.1")).toBeNull();
    expect(normalizeHostname("[::1]")).toBeNull();
    expect(normalizeHostname("127.0.0.1", { allowIpLiteral: true })).toBe("127.0.0.1");
    expect(normalizeHostname("[::1]", { allowIpLiteral: true })).toBe("[::1]");
    expect(normalizeHostname("[::1]:80", { allowIpLiteral: true })).toBeNull();
  });

  it("rejects public suffixes unless allowed, including private-section ones", () => {
    for (const suffix of ["com", "co.uk", "github.io", "blogspot.com"]) {
      expect(normalizeHostname(suffix)).toBeNull();
    }
    expect(normalizeHostname("co.uk", { allowPublicSuffix: true })).toBe("co.uk");
    expect(normalizeHostname("github.io", { allowPublicSuffix: true })).toBe(
      "github.io",
    );
    expect(normalizeHostname("acme.github.io")).toBe("acme.github.io");
    expect(normalizeHostname("example.co.uk")).toBe("example.co.uk");
  });
});

describe("isApexHostname", () => {
  it("is public-suffix aware", () => {
    expect(isApexHostname("example.com")).toBe(true);
    expect(isApexHostname("www.example.com")).toBe(false);
    expect(isApexHostname("example.co.uk")).toBe(true);
    expect(isApexHostname("www.example.co.uk")).toBe(false);
    expect(isApexHostname("acme.github.io")).toBe(true);
    expect(isApexHostname("com")).toBe(false);
    expect(isApexHostname("")).toBe(false);
    expect(isApexHostname("1.2.3.4")).toBe(false);
  });
});

describe("createDnsResolver", () => {
  it("builds a resolver and rejects malformed server addresses", () => {
    const resolver = createDnsResolver({
      servers: ["1.1.1.1", "8.8.8.8"],
      timeoutMs: 100,
    });
    expect(typeof resolver.resolveTxt).toBe("function");
    expect(() => createDnsResolver({ servers: ["not an address"] })).toThrow();
  });
});
