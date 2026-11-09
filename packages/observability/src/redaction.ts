const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const TOKEN = /\b[A-Za-z0-9_-]{24,}\b/g;
const SECRET_KEYS =
  /^(authorization|cookie|password|secret|token|api[_-]?key|pepper|digest|card|cvv|pan)$/i;
const SENSITIVE_ASSIGNMENT =
  /\b(authorization|cookie|password|secret|token|api[_-]?key|pepper|digest|card|cvv|pan)\b\s*([=:])\s*(?:"[^"]*"|'[^']*'|[^\s,;&})\]]+)/gi;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;

export function redactText(
  input: string,
  limit = 500,
  options: { keepLongTokens?: boolean } = {},
): string {
  let masked = input
    .replace(SENSITIVE_ASSIGNMENT, "$1$2[redacted]")
    .replace(BEARER_TOKEN, "Bearer [redacted]")
    .replace(EMAIL, "[redacted-email]");
  if (!options.keepLongTokens) masked = masked.replace(TOKEN, "[redacted-token]");
  if (masked.length <= limit) return masked;
  return `${masked.slice(0, limit)}...`;
}

export function isSensitiveKey(key: string): boolean {
  return SECRET_KEYS.test(key);
}

/**
 * Keeps allowlisted keys only, with secrets and emails masked. Values of
 * `identifierKeys` (opaque record ids such as UUIDs) skip the long-token mask,
 * which would otherwise hide every id of 24 or more characters.
 */
export function pickAllowlisted(
  input: Record<string, unknown>,
  allowlist: ReadonlySet<string>,
  identifierKeys: ReadonlySet<string> = new Set(),
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!allowlist.has(key) || isSensitiveKey(key)) continue;
    if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (typeof value === "string") {
      out[key] = redactText(value, 500, { keepLongTokens: identifierKeys.has(key) });
    }
  }
  return out;
}

export function opaqueSubjectId(value: unknown): string {
  if (value === null || value === undefined) return "system";
  const normalized = String(value).trim();
  return normalized || "system";
}
