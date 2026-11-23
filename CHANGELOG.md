# Changelog

## Unreleased

### Added

- `verifyStandardWebhookSignature` and `StandardWebhookSignatureOptions` for
  Standard Webhooks v1 signatures: HMAC-SHA256 over `id.timestamp.rawBody`,
  `whsec_` base64 secrets, a default 300-second tolerance, and space-separated
  signatures. `svix-id`, `svix-timestamp` and `svix-signature` use the same values.
- `verifyPaddleSignature` and `PaddleSignatureOptions` for Paddle Billing
  `Paddle-Signature` headers (`ts` and one or more `h1` values), HMAC-SHA256, and
  a default five-second replay window in both directions.
- `verifyLemonSqueezySignature` and `LemonSqueezySignatureOptions` for Lemon
  Squeezy `X-Signature` lowercase hex HMAC-SHA256 digests of the raw body.
- Timing-safe comparison, raw `Buffer` or string bodies, and the existing
  `previousSecrets` overlap of up to two keys for all three verifiers.

### Documentation

- README usage, API and security sections for the three verifiers, including raw
  body handling. Package description and keywords list them. The package version
  is unchanged.

These verifiers are not in the published npm package until a release is prepared.
This change does not publish a version. Stripe, GitHub, Shopify, Slack and generic
HMAC verification are unchanged.

## 0.9.0 — 2026-11-18

### Added

- Dependency-free verifyCloudSignature and CloudSignatureOptions exports for
  exact-byte Cloud destination signatures, canonical event identity, bounded
  multi-signature/key overlap, constant-time digest comparison and timestamp
  checks (default and maximum tolerance: 300 seconds).
- A tested Cloud receiver example authenticating before business work and
  deduplicating retries by stable Cloud identity.
- Shared Cloud/library binary signature vectors and malformed-header,
  tampering, clock-boundary, rotation and duplicate-identity tests.

Release preparation only: requires owner-approved v0.9.0 tag/publication.
Cloud implementation/deployment and endpoint configuration remain separate;
published 0.8.1 does not expose this API.

## 0.8.1 — 2026-11-18

### Fixed

- Reject unacknowledged completion in RedisStore and PostgresStore instead of
  allowing handleWebhook to report processed after its claim expired or changed
  owners. Keep the Promise<void> store interface and use WebhookError on failure.
- Apply the same active-lease check in MemoryStore, including expiry without
  takeover. Preserve owner-safe cleanup, heartbeat shutdown and original errors.
- Test expiry, takeover, repeated completion and cleanup failures, including real
  isolated Redis/PostgreSQL completion races in CI.

### Documentation

- Explain completion acknowledgement for custom stores and the risk of repeated
  side effects after a handler succeeds but recording completion fails.
- Update signing-secret rotation guidance to match the published 0.8.0 package.

Release preparation only: publication requires owner approval and the matching
v0.8.1 tag. This change does not update Cloud's installed dependency.

## 0.8.0 — 2026-10-21

### Added

- Optional signing-secret rotation for generic HMAC, Stripe, GitHub, Shopify and
  Slack verification and provider event parsers. Keep the existing current secret
  and accept up to two explicitly configured previous secrets during overlap.
- Reject oversized, empty, duplicate or malformed previous-secret configuration
  with a fixed error. Evaluate every configured key without returning its index.
- Preserve exact bytes, provider timestamp/signature checks, parser identity and
  existing single-secret calls. Rotation does not extend replay tolerance.
- Add usage/example guidance and all-provider overlap/removal/tamper/parser and
  duplicate-identity regression coverage.

The application removes previous secrets after its overlap window. This package
adds no secret storage, automatic expiration or provider-side key rotation.
Publication requires owner approval and the matching v0.8.0 tag. Cloud management
and encrypted secret storage remain a separate future feature.

## 0.7.4 — 2026-10-21

### Fixed

- Release processing claims when application handlers throw synchronously.
- Drain active lease renewals before completion/release; reject lost ownership
  rather than allowing a late handler completion. Preserve processing and release
  failures together as an AggregateError with the original failure as its cause.
- Preserve original Buffer bytes in generic, GitHub and Stripe signature checks.
- Reject malformed/ambiguous Stripe timestamps, non-finite clocks, empty signing
  secrets and malformed signature lengths; retain multiple-v1 support.
- Require canonical SHA-256 Base64 signatures for Shopify instead of accepting
  decorated headers through Node's permissive Base64 decoder.

Publication requires the matching v0.7.4 tag and owner approval. Cloud adoption is
separate; this release does not change hosted ingestion, delivery or retention.

## 0.7.3 — 2026-10-18

### Documentation

- Link to Webhook Safe Cloud from the README introduction so npm readers can
  find the hosted service at https://www.webhook-safe.com.
- No runtime API or dependency changes.

## 0.7.2 — 2026-10-18

### Documentation and discovery

- Shorten Slack usage documentation to match the other provider sections; move
  setup/troubleshooting to a focused example guide and remove obsolete version/install copy.
- Add provider navigation, Slack API reference entries and a clear library/Cloud distinction.
- Improve npm description and relevant keywords; use a public HTTPS repository URL.
- Prepare package and lockfile version 0.7.2; no runtime API or dependency changes.

Publication is pending the matching v0.7.2 release tag; merging this preparation
alone does not publish the package.


## 0.7.1 — 2026-10-18

### Documentation

- Align the Slack guide with the existing provider usage, signature-verification
  and event-parsing sections. Add HTTP setup, the Socket Mode requirement,
  mention testing, retry troubleshooting and the separate Cloud guide.

## 0.7.0 — 2026-10-17

### Added

- Slack v0 request signature verification using original body bytes, strict
  signature/timestamp headers and a maximum five-minute timestamp window.
- Signed Slack Events API callback parsing and URL-verification challenge results.
- Durable-queue acceptance example and retry/idempotency guidance.

This release adds the Slack helpers. Cloud support is implemented and released
separately. Publication is performed by GitHub Actions when the matching v0.7.0
tag is pushed; merging the version update alone does not publish the package.

Historical package versions are available on the
[npm versions page](https://www.npmjs.com/package/webhook-safe?activeTab=versions).
