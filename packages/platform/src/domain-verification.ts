import { randomBytes } from "node:crypto";
import { Resolver } from "node:dns/promises";
import { getDomain } from "tldts";

export type DnsResolver = {
  resolveTxt(name: string): Promise<string[][]>;
  resolveCname(name: string): Promise<string[]>;
  resolve4(name: string): Promise<string[]>;
};

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_CNAME_HOPS = 16;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("dns_lookup_timeout")), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * A `node:dns` resolver. `servers` pins the recursive resolvers to ask (use
 * trusted ones, not whatever the container is configured with). Every lookup
 * is bounded by `timeoutMs` (default 5000).
 */
export function createDnsResolver(
  options: { servers?: string[]; timeoutMs?: number } = {},
): DnsResolver {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
  if (options.servers && options.servers.length > 0) {
    resolver.setServers(options.servers);
  }
  return {
    resolveTxt: (name) => withTimeout(resolver.resolveTxt(name), timeoutMs),
    resolveCname: (name) => withTimeout(resolver.resolveCname(name), timeoutMs),
    resolve4: (name) => withTimeout(resolver.resolve4(name), timeoutMs),
  };
}

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const PSL = { allowPrivateDomains: true } as const;

/**
 * Lowercases, converts IDN to punycode and strips a trailing dot. Returns null
 * for ports, paths, credentials, invalid labels and single-label names; IP
 * literals and public suffixes (`com`, `co.uk`, `github.io`) are rejected
 * unless the matching option is set.
 */
export function normalizeHostname(
  input: string,
  options: { allowIpLiteral?: boolean; allowPublicSuffix?: boolean } = {},
): string | null {
  if (typeof input !== "string") return null;
  let candidate = input.trim().replace(/^https?:\/\//i, "");
  if (candidate.endsWith("/")) candidate = candidate.slice(0, -1);
  if (!candidate || /[\s/?#\\@%]/.test(candidate)) return null;

  const bracketed = candidate.startsWith("[") && candidate.endsWith("]");
  if (candidate.includes(":") && !bracketed) return null;

  let hostname: string;
  try {
    hostname = new URL(`http://${candidate}`).hostname;
  } catch {
    return null;
  }
  hostname = hostname.replace(/\.$/, "").toLowerCase();
  if (!hostname || hostname.length > 253) return null;

  // WHATWG URL canonicalises IPv4 shorthands (`1.2`, `0x7f.1`) to dotted quads.
  const isIp = hostname.startsWith("[") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
  if (isIp) return options.allowIpLiteral ? hostname : null;

  const labels = hostname.split(".");
  if (labels.length < 2 || labels.some((label) => !LABEL.test(label))) {
    return null;
  }
  if (!options.allowPublicSuffix && getDomain(hostname, PSL) === null) {
    return null;
  }
  return hostname;
}

/**
 * True when the hostname equals its registrable domain (public-suffix aware):
 * `example.co.uk` is an apex, `www.example.co.uk` is not.
 */
export function isApexHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  return normalized !== "" && getDomain(normalized, PSL) === normalized;
}

/** 16 random bytes, hex encoded. */
export function issueOwnershipToken(): string {
  return randomBytes(16).toString("hex");
}

function normalizeDnsName(name: string): string {
  return name.trim().replace(/\.$/, "").toLowerCase();
}

export function createDomainVerification(options: {
  label: string;
  resolver?: DnsResolver;
}) {
  const resolver = options.resolver ?? createDnsResolver();
  const label = options.label;

  async function cnameChainIncludes(
    hostname: string,
    target: string,
  ): Promise<boolean> {
    const seen = new Set<string>();
    let current = normalizeDnsName(hostname);
    while (!seen.has(current) && seen.size < MAX_CNAME_HOPS) {
      seen.add(current);
      let records: string[];
      try {
        records = await resolver.resolveCname(current);
      } catch {
        return false;
      }
      const next = records.map(normalizeDnsName);
      if (next.includes(target)) return true;
      if (next.length === 0) return false;
      current = next[0] as string;
    }
    return false;
  }

  return {
    /** The TXT record the customer publishes. The value is the bare token. */
    ownershipRecord(hostname: string, token: string) {
      return {
        type: "TXT" as const,
        name: `${label}.${hostname}`,
        value: token,
      };
    },

    /** TXT at `<label>.<hostname>` whose joined chunks equal the token. */
    async verifyOwnership(hostname: string, token: string): Promise<boolean> {
      if (!token) return false;
      try {
        const records = await resolver.resolveTxt(`${label}.${hostname}`);
        return records.some((chunks) => chunks.join("").trim() === token);
      } catch {
        return false;
      }
    },

    /**
     * The CNAME chain from `hostname` reaches `cnameTarget`. An apex may
     * instead use CNAME flattening: it must resolve to A records, which must
     * equal `aRecords` when that set is given.
     */
    async verifyRouting(
      hostname: string,
      target: { cnameTarget: string; aRecords?: string[] },
    ): Promise<boolean> {
      if (await cnameChainIncludes(hostname, normalizeDnsName(target.cnameTarget))) {
        return true;
      }
      if (!isApexHostname(hostname)) return false;
      let addresses: string[];
      try {
        addresses = (await resolver.resolve4(hostname)).slice().sort();
      } catch {
        return false;
      }
      if (addresses.length === 0) return false;
      const required = (target.aRecords ?? []).slice().sort();
      if (required.length === 0) return true;
      return (
        required.length === addresses.length &&
        required.every((ip, index) => ip === addresses[index])
      );
    },
  };
}
