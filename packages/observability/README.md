# @codelitdev/observability

Explicit `createObservability` factory for structured stdout logging and
optional exception/event capture. The package does not read environment
variables or construct SDK clients at import. Products pass configuration
and own event catalogs. Tenant identity is an opaque `subjectId`.

Pass `posthog: { apiKey }` for best-effort HTTP capture or provide a typed
client in tests. `logs.otlp` adds an OTLP/HTTP log fan-out while structured
stdout remains enabled; both remote pipelines are failure-isolated and
timeout-bounded during shutdown. Log records carry `service.name` and
`deployment.environment` as resource attributes, the pino level as severity,
the message as body and the remaining fields as attributes.

Exceptions are sent with `$exception_list` (type, message and stack frames),
which PostHog error tracking needs to group them into issues.

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

`captureEvent` takes optional `groups` (`{ school: id }`, sent as PostHog
`$groups` so funnels can be measured per account, not per person) and
`personProperties` (sent as `$set`, through the same allowlist). Its
60-second fingerprint dedupe suits noisy signals; product events pass
`dedupe: false` so each occurrence counts. `processPerson: false` sends an
event that creates no person; PostHog does not link such events to groups,
so when group analytics must count an event with no signed-in user behind it,
send it under one stable subject per group instead. `identifyGroup` sets
allowlisted properties on a group, such as its plan, under PostHog's
`$type_key` distinct id. The `distinct_id` is the
`subjectId` as given: pass the same user id the browser identifies with, or
server and browser events land on different people.

Next.js (and other browser) apps use `createBrowserObservability` from
`@codelitdev/observability/browser`. Pass `apiKey` from request-time env
(`POSTHOG_API_KEY`), not `NEXT_PUBLIC_*`, so OSS images can enable telemetry
at container start. Missing `apiKey` is a no-op and does not load
`posthog-js`. After init, call `identify({ id })` with a stable auth user id
and `reset()` on logout. Call `group("school", id)` once the
active account is known so browser events join the same group as server
events. Uncaught errors and unhandled rejections are captured as
`$exception` unless `captureExceptions: false`. Session recording uses
PostHog JS defaults; enable Session replay on the project to record.
