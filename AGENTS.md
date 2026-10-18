# Instructions for coding agents

Every new feature must update its relevant API/usage documentation, examples
where helpful, and CHANGELOG.md in the same PR. Keep pending changes under
Unreleased until preparing their release.
Do not describe unpublished exports or Cloud integrations as available.

Use the existing TypeScript exports, error conventions and dependency-free
provider helpers. Preserve exact signed bytes, verify before parsing, and test
tampering, timestamps and retry/idempotency behavior for provider adapters.
Use isolated Redis/PostgreSQL fixtures only. Never publish npm versions, merge
or change production configuration without owner authorization.

## Release preparation

The owner expects agents to handle release versioning rather than delegate it back.
For publishable package changes, including npm-facing README or metadata updates,
prepare an appropriate SemVer bump in package.json and both root version fields in
package-lock.json, and a matching dated CHANGELOG.md entry in the same PR. Check
master and the published npm version first; preserve dependency resolutions and
avoid bumping again when an unreleased version already covers the change. Provide
the matching release tag/title and notes, and verify package/lock/tag consistency.
Use a patch for documentation/metadata-only releases. This standing instruction
covers release preparation; merging, tagging and npm publication still require
owner authorization. Do not claim publication from a merged version bump alone.
