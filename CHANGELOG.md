# Changelog

## Unreleased

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
