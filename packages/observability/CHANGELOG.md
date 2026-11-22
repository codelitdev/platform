# @codelitdev/observability

## 0.15.0

### Minor Changes

- c30e278: Product analytics support: `captureEvent` accepts `groups` (sent as PostHog `$groups`), `personProperties` (`$set`) and `processPerson: false` (`$process_person_profile: false`) for events with no user behind them, and `dedupe: false` so every occurrence of a product event counts. New `identifyGroup` sets allowlisted group properties. The browser client gains `group(type, key)` and captures uncaught errors as `$exception` by default (`captureExceptions: false` turns it off).

### Patch Changes

- 4c835cf: PostHog ingestion fixes found by checking real data:
  
  - Server exceptions carry `$exception_list` with stack frames, so PostHog error tracking groups them into issues. Before, they arrived as `$exception` events but no issue was created.
  - OTLP logs carry `service.name` and `deployment.environment` resource attributes, the pino level as severity, the timestamp, the message as body and the other fields as attributes. Before, each record was one raw JSON string with no service.
  - `$groupidentify` uses PostHog's `$type_key` distinct id, so it no longer shares an id with a real subject such as `school_<id>`.

## 0.14.1

No changes in this release.

## 0.14.0

No changes in this release.

## 0.13.0

No changes in this release.

## 0.12.0

No changes in this release.

## 0.11.0

No changes in this release.

## 0.10.0

No changes in this release.

## 0.9.0

No changes in this release.

## 0.8.2

No changes in this release.

## 0.8.1

No changes in this release.

## 0.8.0

No changes in this release.

## 0.7.0

No changes in this release.

## 0.6.0

No changes in this release.

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
