---
"@codelitdev/observability": patch
---

Batch and retry telemetry: PostHog captures go to `/batch/` and OTLP logs are sent many records per request, every second or 50 items, with a 10-second timeout and two retries on network errors, 429 and 5xx. Previously each item was its own request, aborted after 2 seconds without a retry, so bursts or a slow network silently dropped events. Add `contextPolicy.identifierKeys` so allowlisted id properties (UUIDs) aren't masked as tokens.
