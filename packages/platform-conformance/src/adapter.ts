export type PlatformConformanceAdapter<
  Principal,
  Tenant,
  SessionCredential,
  OAuthCredential,
  ApiKeyCredential,
  HttpInput,
  McpInput,
  McpOutput,
  AuditEvent,
> = {
  reset(): Promise<void>;
  /** Optional cleanup for fixtures that allocate an HTTP listener. */
  close?(): Promise<void>;
  fixtures: {
    owner: Principal;
    member: Principal;
    outsider: Principal;
    tenantA: Tenant;
    tenantB: Tenant;
  };
  credentials: {
    session(principal: Principal): Promise<SessionCredential>;
    oauth(principal: Principal): Promise<OAuthCredential>;
    apiKey(
      tenant: Tenant,
      permissions: readonly string[],
    ): Promise<ApiKeyCredential>;
    system?(principal: Principal): Promise<{ kind: "system" }>;
  };
  http(input: HttpInput): Promise<{
    status: number;
    body: unknown;
    headers?: Record<string, string>;
  }>;
  mcp?(input: McpInput): Promise<McpOutput>;
  readAuditEvents(): Promise<readonly AuditEvent[]>;
  openapiDocument?(): Promise<{
    paths: Record<string, unknown>;
    contractOperationIds: readonly string[];
  }>;
  observability?: {
    redact(secret: string): Promise<string>;
    disabledDoesNotThrow(): Promise<{ threw: boolean }>;
    failingSinkDoesNotFailRequest(): Promise<{ requestStatus: number }>;
  };
  billingComposition?: {
    generatedSchemaCurrent(): Promise<boolean>;
    actionGrantRejected(): Promise<boolean>;
    fakeProviderWorks(): Promise<boolean>;
    maintenanceInvoked(): Promise<boolean>;
    auditRecorded(): Promise<boolean>;
  };
  shutdown?(): Promise<{ mcpStatus: number }>;
};

export type ConformanceCapabilities = {
  mcp?: boolean;
  billing?: boolean;
  observability?: boolean;
  openapi?: boolean;
  shutdown?: boolean;
};

export type ConformanceFailure = {
  suite: string;
  message: string;
};
