# Changelog

## Unreleased

### Added

- Slack v0 request signature verification using original body bytes, strict
  signature/timestamp headers and a maximum five-minute timestamp window.
- Signed Slack Events API callback parsing and URL-verification challenge results.
- Durable-queue acceptance example and retry/idempotency guidance.

These changes require a new npm release. The published 0.6.1 package does not yet
include the Slack helpers. Cloud support is implemented and released separately.

Historical package versions are available on the
[npm versions page](https://www.npmjs.com/package/webhook-safe?activeTab=versions).
