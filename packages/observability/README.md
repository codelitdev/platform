# @codelitdev/observability

Explicit `createObservability` factory for structured stdout logging and
optional exception/event capture. The package does not read environment
variables or construct SDK clients at import. Products pass configuration
and own event catalogs. Tenant identity is an opaque `subjectId`.

Pass `posthog: { apiKey }` for best-effort HTTP capture or provide a typed
client in tests. `logs.otlp` adds an OTLP/HTTP log fan-out while structured
stdout remains enabled; both remote pipelines are failure-isolated and
timeout-bounded during shutdown.

Both pipelines queue what they send and post it in batches (PostHog
`/batch/`, one OTLP request per batch): every second or once 50 items are
waiting, with a 10-second request timeout and two retries on network errors,
429 and 5xx. The queue holds at most 1,000 items, dropping the oldest. Call
`shutdown()` before a process exits, or queued items are lost.

`contextPolicy.propertyAllowlist` decides which properties are sent. String
values are masked for emails, secrets and anything that looks like a token
(24 or more letters, digits, `-` or `_`). List keys that hold opaque record
ids, such as `team_id`, in `contextPolicy.identifierKeys` so their UUIDs are
not masked too. Never list a key that can hold a session or access token.

Next.js (and other browser) apps use `createBrowserObservability` from
`@codelitdev/observability/browser`. Pass `apiKey` from request-time env
(`POSTHOG_API_KEY`), not `NEXT_PUBLIC_*`, so OSS images can enable telemetry
at container start. Missing `apiKey` is a no-op and does not load
`posthog-js`. After init, call `identify({ id })` with a stable auth user id
and `reset()` on logout. Session recording uses PostHog JS defaults; enable
Session replay on the project to record.
