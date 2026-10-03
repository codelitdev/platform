import type { PlatformError } from "./errors.js";

export type CredentialKind = "session" | "oauth" | "api_key" | "system";

export interface PlatformCredential {
  kind: CredentialKind;
  credentialId?: string;
  /**
   * OAuth scopes granted to the token. Set only for `oauth` credentials;
   * products narrow the principal's permissions to what these scopes allow.
   */
  scopes?: readonly string[];
}

export interface PlatformRequestContext<
  PrincipalId extends string,
  TenantId extends string,
  Permission extends string,
> {
  requestId: string;
  principalId: PrincipalId;
  tenantId: TenantId | null;
  credential: PlatformCredential;
  permissions: ReadonlySet<Permission>;
}

export type AuthenticationResult<PrincipalId extends string> =
  | {
      kind: "authenticated";
      principalId: PrincipalId;
      credential: PlatformCredential;
    }
  | { kind: "absent" }
  | { kind: "rejected"; error: PlatformError };

export interface AuthenticationAdapter<Request, PrincipalId extends string> {
  authenticate(request: Request): Promise<AuthenticationResult<PrincipalId>>;
}

export interface TenantContextAdapter<
  PrincipalId extends string,
  TenantId extends string,
  Permission extends string,
> {
  resolve(input: {
    principalId: PrincipalId;
    credential: CredentialKind;
    requestedTenantId: TenantId | null;
  }): Promise<{
    tenantId: TenantId | null;
    permissions: ReadonlySet<Permission>;
  }>;
}

export interface AuthorizationAdapter<Context, Action extends string, Resource> {
  authorize(input: {
    context: Context;
    action: Action;
    resource: Resource;
  }): Promise<{ allowed: true } | { allowed: false; error: PlatformError }>;
}

export interface AuditPort<Context, Event> {
  record(context: Context, event: Event): Promise<void>;
}

export type TransportName = "http" | "mcp";
