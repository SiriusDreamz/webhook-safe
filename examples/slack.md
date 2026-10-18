# Slack Events API setup and troubleshooting

Use [the Slack usage guide](https://github.com/SiriusDreamz/webhook-safe#slack-events-api)
for parsing and [slack.ts](https://github.com/SiriusDreamz/webhook-safe/blob/master/examples/slack.ts)
for the framework-neutral durable-queue acceptance contract.

## Configure the app

1. Turn **Socket Mode off**. Socket Mode delivers over a WebSocket instead of
   your HTTP Request URL, even when that URL shows Verified.
2. Enable Event Subscriptions and set your HTTPS receiver as the Request URL.
   Verify the signed challenge and return HTTP 200 with its JSON challenge immediately.
3. Subscribe to the bot events you need. For `app_mention`, request the
   `app_mentions:read` bot scope.
4. Save changes, install or reinstall the app in the intended workspace and
   invite it to your test channel. Select the app from the `@` suggestions in a new message.

Use the Signing Secret under Basic Information → App Credentials. Bot tokens,
client secrets and deprecated body verification tokens do not establish request
authenticity. Enforce a body-size limit and reject duplicate signature/timestamp
headers in your HTTP adapter. Preserve original bytes and verify before parsing.

## Acknowledge safely

Slack expects acknowledgment within three seconds. Do not queue URL challenges
as business events. For callbacks, durably accept/deduplicate the signed event
identity before returning HTTP 200; return a non-2xx response if persistence fails.
Business processing happens later. An in-process claim or detached promise is not
durable queue acceptance. Never log bodies, challenges, tokens or signing secrets.

Use the app/team/event tuple from the verified envelope as a namespaced key.
`handleWebhook` can guard work in the durable consumer with a shared Redis or
PostgreSQL store. Make downstream effects idempotent: remote effects and marking
the event completed are not one atomic transaction. Do not discard an event merely
because `X-Slack-Retry-Num` exists; its earlier attempt may never have persisted.

## Troubleshoot

| Symptom | Check |
| --- | --- |
| Verified URL, no callbacks | Socket Mode off, saved subscriptions, permissions/reinstallation, app channel membership and a real app mention |
| Signature rejected | Correct Signing Secret, exact raw bytes, one signature/timestamp value and a synchronized clock; keep verification enabled |
| Unexpected event counts | Compare signed event IDs; a retry repeats an event identity, while a new mention creates a new event |
| Ingestion succeeds, application work does not | Inspect the durable consumer and destination separately; acknowledgment is not completed business work |

## Using Cloud instead

For managed ingestion and forwarding, use the separate
[Cloud Slack guide](https://www.webhook-safe.com/docs/providers#slack).
Slack sends to Cloud's ingestion URL; Cloud sends to your application's destination.
Cloud handles signed setup challenges and records accepted callbacks. Installing
the library alone does not create a hosted endpoint.

Provider references: [request verification](https://docs.slack.dev/authentication/verifying-requests-from-slack/),
[URL verification](https://docs.slack.dev/apis/events-api/using-http-request-urls/),
[event delivery and retries](https://docs.slack.dev/apis/events-api/).
