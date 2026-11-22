---
"@codelitdev/observability": minor
---

Product analytics support: `captureEvent` accepts `groups` (sent as PostHog `$groups`), `personProperties` (`$set`) and `processPerson: false` (`$process_person_profile: false`) for events with no user behind them, and `dedupe: false` so every occurrence of a product event counts. New `identifyGroup` sets allowlisted group properties. The browser client gains `group(type, key)` and captures uncaught errors as `$exception` by default (`captureExceptions: false` turns it off).

Fixes: server exceptions now carry `$exception_list` with stack frames, so PostHog error tracking turns them into issues. OTLP logs carry `service.name` and `deployment.environment` resource attributes, severity, timestamp and attributes instead of one raw JSON string. `$groupidentify` uses PostHog's `$type_key` distinct id, so it no longer shares an id with a real subject.
