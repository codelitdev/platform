---
"@codelitdev/observability": patch
---

PostHog ingestion fixes found by checking real data:

- Server exceptions carry `$exception_list` with stack frames, so PostHog error tracking groups them into issues. Before, they arrived as `$exception` events but no issue was created.
- OTLP logs carry `service.name` and `deployment.environment` resource attributes, the pino level as severity, the timestamp, the message as body and the other fields as attributes. Before, each record was one raw JSON string with no service.
- `$groupidentify` uses PostHog's `$type_key` distinct id, so it no longer shares an id with a real subject such as `school_<id>`.
