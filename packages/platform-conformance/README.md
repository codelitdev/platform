# @codelitdev/platform-conformance

Shared integration checks for products built with CodeLit [Platform](https://github.com/codelitdev/platform) packages.
Conformance tests the behavior of a product after it composes the packages with
its own routes, credentials, tenants, policies, database, and workers. Package
unit tests and product domain tests still have their own jobs.

The product supplies fixtures and adapters, calls the suites it uses, and
asserts that every returned `failures` array is empty. Installing this package
does not run a test or create a CI gate.

## Scope

The [Platform architecture](../../docs/architecture.md) calls for these
product-level checks. The last column distinguishes working checks from gaps;
the reference runner is not yet a general adapter for every product.

| Area | Product-level invariant | Coverage today |
| --- | --- | --- |
| Credentials | Sessions, OAuth tokens, and API keys resolve to the right principal; ambiguous or invalid credentials fail without fallback; transport clients cannot present a trusted system identity. | Some cases in the reference runner. |
| OAuth integration | Advertised issuer, authorization and token endpoints, resource metadata, and declared DCR/CIMD support match the running product. | MCP protected-resource discovery has an independent suite; authorization-server and client-registration checks still need one. |
| Tenancy and identity lifecycle | Membership is rechecked, API keys stay fixed to one tenant, cross-tenant access is denied, and key revocation, invitations, and last-owner safeguards work. | Basic isolation in the reference runner; lifecycle cases remain product tests. |
| REST and OpenAPI | Runtime validation, stable safe errors, and generated OpenAPI agree with the product contract. | Reference-specific checks for `/v1/notes` and its operations. |
| MCP transport and parity | Anonymous requests receive an OAuth challenge; authenticated tools follow product policy and match equivalent REST capabilities; destructive actions require explicit proof. | Independent discovery suite and reference-specific tool checks. Static parity validation lives in `@codelitdev/mcp-server-kit`. |
| Observability | Disabled telemetry is safe, secrets are redacted, and a failed optional sink does not fail requests or jobs. | Reference runner hooks; independent composition suite still needed. |
| Billing composition | Product schema, action grants, audit hooks, fake-provider flow, and maintenance are wired correctly. | Reference runner hooks. Provider and workflow contracts live in `@codelitdev/billing/testing`. |
| Lifecycle | Health and readiness reflect state; shutdown stops new work and closes resources. | Reference runner checks fixed endpoints; independent suite still needed. |
| Version compatibility | Resolved packages satisfy supported and minimum-secure versions. | Owned by `platform-cli doctor` and the preset it ships; product CI should run that check. |

Conformance belongs at the product boundary. A fabricated response from a mock
adapter cannot establish that the real auth middleware, route, or worker works.
New suites should accept product-defined paths, operations, credentials, and
fixture setup rather than assume the reference product's notes resource. They
should reuse package-owned protocol or provider contracts instead of copying
them.

## Available runners

`runPlatformConformance(adapter, capabilities)` exercises the reference
product's owner/member/outsider and two-tenant scenario. It covers parts of
auth, tenancy, REST, MCP, OpenAPI, observability, billing, readiness, and
shutdown. Its current requests assume `/v1/notes`, `notes.*` MCP tools, and
reference billing routes. Existing adopters can keep using it; products with
other domain models should not manufacture notes responses to make it pass.
See the [reference adapter](../../examples/reference-product/apps/api/src/conformance-adapter.ts)
for its fixture and HTTP shape.

`runMcpDiscoveryConformance(adapter, { resourceUrl })` is an independent HTTP
suite. It accepts the product's public MCP resource URL and a `request` adapter
that returns status, headers, and parsed body. It checks the anonymous `401`,
Bearer resource-metadata challenge, protected-resource metadata, and
advertised authorization servers. It does not assume a tool name, tenant
model, framework, or billing setup. See its [HTTP test](src/mcp-discovery.test.ts)
for an adapter using an ephemeral listener.

```ts
import {
  runMcpDiscoveryConformance,
  runPlatformConformance,
} from "@codelitdev/platform-conformance";

// Use the composition runner only if your adapter implements its reference scenario.
const composition = await runPlatformConformance(referenceAdapter, {
  mcp: true,
  billing: true,
  observability: true,
  openapi: true,
  shutdown: true,
});
expect(composition.failures).toEqual([]);

// Any MCP product can use its real HTTP route for this independent suite.
const discovery = await runMcpDiscoveryConformance(
  { request: productHttpRequest },
  { resourceUrl: "http://127.0.0.1:8000/mcp" },
);
expect(discovery.failures).toEqual([]);
```

Run only the suites applicable to the product, but do not treat an omitted
suite as a pass. Products should declare their supported capabilities in their
test setup and keep the selected suites visible in review. A suite that needs
HTTP must exercise the real route, including auth and discovery middleware.

## Product CI

Create disposable fixtures, start a local API listener or equivalent test
instance, run the selected suites, and close the listener, database, and
workers afterward. The test should be part of the API package's normal test
command. Run it after a frozen install on pull requests, and make that CI job a
required branch-protection check. A push-only workflow cannot guard a pull
request. Run `platform-cli doctor` in the same gate for installed versions and
managed configuration; it does not prove behavioral conformance.
