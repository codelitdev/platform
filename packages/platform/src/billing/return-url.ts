/**
 * Validator for `createBilling({ returnUrlValidator })`: accepts only URLs on
 * one of the given origins, such as the product's dashboard.
 */
export function createReturnUrlValidator(
  allowedOrigins: readonly string[],
): (url: string) => boolean {
  const origins = new Set<string>();
  for (const origin of allowedOrigins) {
    try {
      origins.add(new URL(origin).origin);
    } catch {
      // An invalid origin allows nothing.
    }
  }
  return (url) => {
    try {
      const parsed = new URL(url);
      return (
        (parsed.protocol === "https:" || parsed.protocol === "http:") &&
        origins.has(parsed.origin)
      );
    } catch {
      return false;
    }
  };
}
