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
    apiKey(tenant: Tenant, permissions: readonly string[]): Promise<ApiKeyCredential>;
    system?(principal: Principal): Promise<{ kind: "system" }>;
  };
  http(input: HttpInput): Promise<{
    status: number;
    body: unknown;
    headers?: Record<string, string>;
  }>;
  /** Return transport response headers so conformance can verify OAuth discovery challenges. */
  mcp?(input: McpInput): Promise<McpOutput>;
  readAuditEvents(): Promise<readonly AuditEvent[]>;
  openapiDocument?(): Promise<{
    /** Paths of the document the running API serves. */
    paths: Record<string, unknown>;
    /** Operation ids from the contract, e.g. via `listOperationIds`. */
    contractOperationIds: readonly string[];
    /**
     * Whether the committed `openapi.json` equals the document generated from
     * the contract (`generate:openapi --check` passes). Hosted docs serve the
     * committed file, so a stale one publishes the wrong API.
     */
    committedDocumentCurrent: boolean;
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
