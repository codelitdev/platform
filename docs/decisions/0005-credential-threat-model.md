# ADR 0005: Credential and tenant-selection threat model

Status: accepted  
Date: 2026-09-02

## Context

Tenant escape and credential confusion are release blockers (architecture
§13). Products will accept session cookies, OAuth bearer tokens, tenant
API keys, and in-process system contexts.

## Threats and controls

| Threat                                                                           | Control                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Multiple credential mechanisms on one request (confused deputy / mixed identity) | Exactly one mechanism per request. More than one supplied mechanism returns `credential_ambiguous`. No silent precedence.                                                                                                |
| Invalid/expired credential falling back to anonymous or another mechanism        | `rejected` never falls back. Invalid explicit credentials return `unauthenticated`.                                                                                                                                      |
| Forged `system` credential over HTTP or MCP                                      | Transports never accept or emit `system`. System contexts exist only at trusted in-process entry points (webhooks, workers, maintenance).                                                                                |
| `X-Tenant-ID` treated as trusted                                                 | Header is an untrusted selector. Resolver validates the public ID, loads current membership, and derives permissions on every request.                                                                                   |
| API key used to select another tenant                                            | An API key ignores any alternate selector and always resolves to its persisted tenant.                                                                                                                                   |
| API-key secret leakage                                                           | Public lookup ID + ≥256 bits of secret. Store HMAC-SHA-256 with a separately configured pepper. Constant-time compare. Secret shown once. Never log raw keys, digests, or peppers.                                       |
| Stale membership / permission cache                                              | Membership and permissions are loaded for every tenant-scoped operation. Transports never supply trusted permissions.                                                                                                    |
| Last-owner removal / invitation ownership transfer                               | Invitation acceptance cannot transfer ownership or bypass last-owner protection. Removing the last owner is rejected.                                                                                                    |
| Error leakage                                                                    | `message` is never derived from `cause`. Adapters do not expose cause, raw exceptions, database identifiers, secrets, or provider responses.                                                                             |
| Audit vs telemetry confusion                                                     | Security-relevant mutations write an application audit event in the same transaction as the mutation when both use the same database. Telemetry is never a substitute and never participates in the product transaction. |

## Consequences

- The reference product tests the controls above before any template or
  MCP claim.
- Conformance later encodes the same matrix across credential kinds.
- Product-specific roles and permission names stay outside the kernel.
