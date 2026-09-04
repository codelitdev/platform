# @codelitdev/platform

Composition kernel for CodeLit products: request context, credential kinds,
safe errors, UUIDv7 / prefixed public IDs, health/readiness/shutdown, and
HTTP/MCP mapping conventions.

The package imports no product schema, reads no environment at import, and
performs no network I/O. Products implement authentication, tenant, and
authorization adapters.

See `docs/architecture.md` §6.4 and ADR 0001.
