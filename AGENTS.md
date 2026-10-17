# Instructions for coding agents

Every new feature must update its relevant API/usage documentation, examples
where helpful, and CHANGELOG.md in the same PR. Keep pending changes under
Unreleased; identify the actual package version only when preparing its release.
Do not describe unpublished exports or Cloud integrations as available.

Use the existing TypeScript exports, error conventions and dependency-free
provider helpers. Preserve exact signed bytes, verify before parsing, and test
tampering, timestamps and retry/idempotency behavior for provider adapters.
Use isolated Redis/PostgreSQL fixtures only. Never publish npm versions, merge
or change production configuration without owner authorization.
