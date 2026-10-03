export const REFERENCE_PERMISSIONS = [
  "notes:read",
  "notes:write",
  "notes:delete",
  "tenant:admin",
  "billing:read",
] as const;

export type ReferencePermission = (typeof REFERENCE_PERMISSIONS)[number];

export const OWNER_PERMISSIONS: readonly ReferencePermission[] = [
  ...REFERENCE_PERMISSIONS,
];

export const MEMBER_PERMISSIONS: readonly ReferencePermission[] = [
  "notes:read",
  "notes:write",
  "billing:read",
];

/**
 * What each OAuth data scope allows. An OAuth request keeps only the
 * member's permissions that its granted scopes cover, so a token approved
 * as read-only cannot write even when the member could.
 */
export const SCOPE_PERMISSIONS: Readonly<
  Record<string, readonly ReferencePermission[]>
> = {
  "data:read": ["notes:read", "billing:read"],
  "data:write": ["notes:write", "notes:delete", "tenant:admin"],
};

export function narrowToScopes(
  permissions: ReadonlySet<ReferencePermission>,
  scopes: readonly string[],
): Set<ReferencePermission> {
  const allowed = new Set(scopes.flatMap((scope) => SCOPE_PERMISSIONS[scope] ?? []));
  return new Set([...permissions].filter((permission) => allowed.has(permission)));
}

export function parsePermissions(value: string): Set<ReferencePermission> {
  const allowed = new Set<string>(REFERENCE_PERMISSIONS);
  const parsed = new Set<ReferencePermission>();
  for (const item of value.split(",")) {
    const trimmed = item.trim();
    if (allowed.has(trimmed)) parsed.add(trimmed as ReferencePermission);
  }
  return parsed;
}

export function serializePermissions(
  permissions: Iterable<ReferencePermission>,
): string {
  return [...permissions].join(",");
}
