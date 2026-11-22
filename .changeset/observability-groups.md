---
"@codelitdev/observability": minor
---

Product analytics support: `captureEvent` accepts `groups` (sent as PostHog `$groups`), `personProperties` (`$set`) and `processPerson: false` (`$process_person_profile: false`) for events with no user behind them, and `dedupe: false` so every occurrence of a product event counts. New `identifyGroup` sets allowlisted group properties. The browser client gains `group(type, key)` and captures uncaught errors as `$exception` by default (`captureExceptions: false` turns it off).
