# @codelitdev/observability

## 0.5.0

No changes in this release.

## 0.4.2

### Patch Changes

- 5df9b34: Batch and retry telemetry: PostHog captures go to `/batch/` and OTLP logs are sent many records per request, every second or 50 items, with a 10-second timeout and two retries on network errors, 429 and 5xx. Previously each item was its own request, aborted after 2 seconds without a retry, so bursts or a slow network silently dropped events. Add `contextPolicy.identifierKeys` so allowlisted id properties (UUIDs) aren't masked as tokens.

## 0.4.1

No changes in this release.

## 0.4.0

No changes in this release.

## 0.3.0

No changes in this release.

## 0.2.0

No changes in this release.

## 0.1.0

### Patch Changes

- 894896a: Add the observability factory: stdout Pino, optional capture, redaction, dedupe, and bounded shutdown.
