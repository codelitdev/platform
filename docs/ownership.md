# Package ownership and security-response rota

Status: accepted

Code ownership is package-level. A change to a package requires review
from that package's owners. Cross-cutting security issues (tenant escape,
credential confusion, secret leakage) are release blockers and page the
security rota even when they originate in a product repository.

## Package owners

| Path                            | Package                                      | Owners (role)                                                 |
| ------------------------------- | -------------------------------------------- | ------------------------------------------------------------- |
| `packages/billing`              | `@codelitdev/billing`                        | Billing maintainers. Origin canary: SendLit.                  |
| `packages/oauth-server-kit`     | `@codelitdev/oauth-server-kit`               | Auth maintainers. Consumers: FrontLit, SendLit, MediaLit.     |
| `packages/design-system`        | `@codelitdev/design-system`                  | Design-system maintainers.                                    |
| `packages/platform`             | `@codelitdev/platform`                       | Platform kernel maintainers.                                  |
| `packages/observability`        | `@codelitdev/observability`                  | Observability maintainers (SendLit API + CourseLit Queue).    |
| `packages/mcp-server-kit`       | `@codelitdev/mcp-server-kit`                 | MCP maintainers (FrontLit, SendLit, MediaLit).                |
| `packages/platform-conformance` | `@codelitdev/platform-conformance`           | Platform maintainers.                                         |
| `packages/platform-cli`         | `@codelitdev/platform-cli`                   | Platform maintainers.                                         |
| `templates/saas-product`        | template                                     | Platform maintainers. Product-owned seams are not owned here. |
| `examples/reference-product`    | example                                      | Platform maintainers.                                         |
| `docs/`                         | architecture, ADRs, inventory, compatibility | Platform maintainers.                                         |

Until GitHub `CODEOWNERS` teams are provisioned, the fallback reviewer set
is the CodeLit Platform maintainers listed in the GitHub repository
settings.

## Security-response rota

Coordinated disclosure follows `SECURITY.md`.

1. **Intake:** private report via GitHub Security tab. Do not open a
   public issue before triage.
2. **Triage owner:** the on-call Platform maintainer (weekly rotation
   among package owners). Severity for tenant escape or credential
   confusion is always high/critical.
3. **Fix owner:** maintainers of the affected package. If the defect is
   in product adapter code, the product owners patch the product; if the
   kernel contract is wrong, Platform patches and publishes first.
4. **Release:** patch the affected package, record `recommended` and
   `minimumSecure` on the preset (when it exists), open expedited adopter
   PRs. Never push silently into product lockfiles.
5. **Emergency:** coordinated disclosure and an emergency alpha/patch
   release from this repository. Runbooks live in
   `packages/billing/docs/runbooks.md` for billing and in this document
   for kernel/auth issues.

Weekly rota seats (named individuals are assigned in the internal
on-call calendar, not in git):

| Seat            | Covers                                                 |
| --------------- | ------------------------------------------------------ |
| Platform kernel | `@codelitdev/platform`, preset, conformance, CLI, docs |
| Auth            | oauth-server-kit, credential threat model              |
| Billing         | `@codelitdev/billing`                                  |
| Observability   | `@codelitdev/observability`                            |
| MCP             | `@codelitdev/mcp-server-kit`                           |

At least one seat is covered every week. Billing and auth seats may not
be vacant simultaneously.
