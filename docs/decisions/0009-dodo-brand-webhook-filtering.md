# ADR 0009: Filter Dodo webhooks by brand

Status: accepted  
Date: 2026-10-07

## Context

Several products can sell through one Dodo Payments business, each with
its own Dodo brand and its own webhook endpoint. Dodo sends every event of
the business to every endpoint, so each product receives the other products'
payment and subscription events.

`@codelitdev/billing` treated such an event as a failure. Processing looked
up the event's product in the local catalog, found nothing, and quarantined
the event. A product that alerts on quarantined webhooks would page its
operators for another product's ordinary payment.

Dodo includes a `brand_id` on payment, subscription, refund, and related
webhook payloads. An entity without a brand of its own carries the
business's primary brand. Dispute payloads carry no `brand_id`, and payout
payloads are business-level.

## Decision

- `createDodoBillingProvider` accepts an optional `brandId`, the brand the
  product sells under.
- `parseWebhook` still verifies every signature. When `brandId` is set and a
  verified event's `brand_id` names another brand, the envelope is marked
  `foreign`.
- `ingestWebhook` stores a foreign event with status `ignored`, so it is kept
  for deduplication and audit but never processed, retried, or quarantined.
- Events without a `brand_id` are processed as before. Disputes and payouts
  are not subscription events and were already ignored.
- An event from the product's own brand with an unknown product is still
  quarantined, because that is a real configuration error.

## Consequences

- Each product creates its Dodo products under its own brand and sets its
  brand ID, for example through `DODO_BRAND_ID`.
- Products that do not set `brandId` behave exactly as before.
- Every product sharing the business must adopt the setting. A product
  without it still quarantines other products' events.
