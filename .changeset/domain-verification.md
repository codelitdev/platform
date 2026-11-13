---
"@codelitdev/platform": minor
---

Adds custom-domain verification to the root export: `normalizeHostname`, `isApexHostname`, `issueOwnershipToken`, `createDnsResolver` and `createDomainVerification` (`ownershipRecord`, `verifyOwnership`, `verifyRouting`). It keeps the behaviour FrontLit and CourseLit each carry today: the TXT value is the bare token, tokens are 16 hex bytes, CNAME chains are followed with loop protection, and an apex may use CNAME flattening or A records that match a configured set. Lookups go through an injectable resolver that can pin trusted DNS servers and times out after 5 seconds by default. The package now depends on `tldts` for public-suffix handling.

**Product changes for this release**

- FrontLit (`domains/queries.ts`) and CourseLit (`school-hosts.ts`, `school-host.ts`) can replace their copies with this. Apex/`www` pairing and one-domain-per-school stay in the apps.
- `normalizeHostname` replaces CourseLit's `normalizeCustomHostname`. It also rejects public suffixes and IP literals by default, and `isApexHostname` now uses the public suffix list rather than counting labels.
