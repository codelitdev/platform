# @codelitdev/observability

Explicit `createObservability` factory for structured stdout logging and
optional exception/event capture. The package does not read environment
variables or construct SDK clients at import. Products pass configuration
and own event catalogs. Tenant identity is an opaque `subjectId`.

Pass `posthog: { apiKey }` for best-effort HTTP capture or provide a typed
client in tests. `logs.otlp` adds an OTLP/HTTP log fan-out while structured
stdout remains enabled; both remote pipelines are failure-isolated and
timeout-bounded during shutdown.

Next.js (and other browser) apps use `createBrowserObservability` from
`@codelitdev/observability/browser`. Pass `apiKey` from request-time env
(`POSTHOG_API_KEY`), not `NEXT_PUBLIC_*`, so OSS images can enable telemetry
at container start. Missing `apiKey` is a no-op and does not load
`posthog-js`. After init, call `identify({ id })` with a stable auth user id
and `reset()` on logout. Session recording uses PostHog JS defaults; enable
Session replay on the project to record.
