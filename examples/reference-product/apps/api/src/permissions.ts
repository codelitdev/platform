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
