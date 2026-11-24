# webhook-safe

Webhook signature verification and idempotent processing for Node.js and TypeScript.

Verify Stripe, GitHub, Shopify, Slack Events API, Standard Webhooks, Paddle Billing,
Lemon Squeezy, and generic HMAC webhooks. Coordinate duplicate deliveries with an
in-memory, Redis, or PostgreSQL store. The library does not depend on a web framework.
Pass the original request bytes to every verifier.

Standard Webhooks, Paddle Billing, and Lemon Squeezy verification is prepared for
0.10.0 and documented below. Published 0.9.0 does not export these verifiers.
The [changelog](CHANGELOG.md) records that release preparation.

For managed delivery, retries, and event inspection, see
[Webhook Safe Cloud](https://www.webhook-safe.com). This package does not start that service.

## Contents

- [Quick start](#quick-start)
  - [Install](#install)
  - [Node.js](#nodejs)
  - [Express](#express)
  - [Next.js](#nextjs)
- [Providers](#providers)
  - [Generic HMAC](#generic-hmac)
  - [Stripe](#stripe)
  - [GitHub](#github)
  - [Shopify](#shopify)
  - [Slack Events API](#slack-events-api)
  - [Standard Webhooks](#standard-webhooks)
  - [Paddle Billing](#paddle-billing)
  - [Lemon Squeezy](#lemon-squeezy)
- [Idempotency](#idempotency)
  - [Leases and retries](#leases-and-retries)
  - [MemoryStore](#memorystore)
  - [RedisStore](#redisstore)
  - [PostgresStore](#postgresstore)
  - [Custom stores](#custom-stores)
  - [Completion acknowledgement](#completion-acknowledgement-081)
- [Signing-secret rotation](#signing-secret-rotation)
- [API reference](#api-reference)
- [Security](#security)
- [Library or hosted service](#library-or-hosted-service)
- [Cloud delivery verification](#cloud-delivery-verification)
- [Roadmap](#roadmap)
- [License](#license)

## Quick start

Install the package, read the body once as bytes, verify the signature, then pass
the verified event to `handleWebhook`.

Express and Next.js are application frameworks. They are not dependencies of
`webhook-safe`. The samples below show how to obtain the raw body in each one.

### Install

```bash
npm install webhook-safe
```

`MemoryStore` needs no other packages.

```bash
npm install redis
```

```bash
npm install pg
```

`redis` and `pg` are optional peer dependencies, used only by `RedisStore` and
`PostgresStore`.

A bad signature or timestamp throws `WebhookSignatureError`.
`verifyStripeSignature` is the exception: it returns `false` for a bad signature.
Invalid configuration, such as an empty secret or a negative tolerance, throws
`Error`. Parse helpers throw `Error` when the signature, JSON, or envelope is
rejected.

### Node.js

```ts
import { handleWebhook, MemoryStore, verifyHmacSignature } from "webhook-safe";

const store = new MemoryStore();

async function receive(rawBody: Buffer, signatureHeader: string) {
  verifyHmacSignature(rawBody, signatureHeader, process.env.WEBHOOK_SECRET!);
  const event = JSON.parse(rawBody.toString("utf8")) as {
    id: string;
    type: string;
    payload: unknown;
  };

  return handleWebhook(event, {
    store,
    getKey: (value) => value.id,
    handler: async (value) => {
      console.log(value.type);
    },
  });
}
```

`receive` returns `"processed"` or `"duplicate"`. `signatureHeader` is the header
value the sender computed over `rawBody`. `verifyHmacSignature` accepts a
lowercase hex digest or the same digest prefixed with `sha256=`. Pass the
original request bytes. Serializing a parsed object again can change them.

### Express

Mount `express.raw()` on the webhook route. Do not run `express.json()` before
verification. `req.body` is a `Buffer` when this parser is used.

```ts
import express from "express";
import {
  handleWebhook,
  MemoryStore,
  verifyHmacSignature,
  WebhookSignatureError,
} from "webhook-safe";

const store = new MemoryStore();
const app = express();

app.post(
  "/webhooks",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body)) {
      res.status(500).send("Expected the raw request body");
      return;
    }
    try {
      verifyHmacSignature(
        req.body,
        req.header("x-signature") ?? "",
        process.env.WEBHOOK_SECRET!,
      );
    } catch (error) {
      if (error instanceof WebhookSignatureError) {
        res.status(401).send("Invalid signature");
        return;
      }
      throw error;
    }

    const event = JSON.parse(req.body.toString("utf8")) as {
      id: string;
      type: string;
      payload: unknown;
    };
    const result = await handleWebhook(event, {
      store,
      getKey: (value) => value.id,
      handler: async () => {
        // Business work after the signature check.
      },
    });
    res.status(200).json({ result });
  },
);
```

`req.header` matches header names without case sensitivity. Provider sections
name the header each verifier expects. Replace `verifyHmacSignature` with that
verifier. Keep passing `req.body`.

### Next.js

Read the body once, from `arrayBuffer()`, in the route handler.

```ts
import {
  handleWebhook,
  MemoryStore,
  verifyHmacSignature,
  WebhookSignatureError,
} from "webhook-safe";

const store = new MemoryStore();

export async function POST(request: Request) {
  const rawBody = Buffer.from(await request.arrayBuffer());
  try {
    verifyHmacSignature(
      rawBody,
      request.headers.get("x-signature") ?? "",
      process.env.WEBHOOK_SECRET!,
    );
  } catch (error) {
    if (error instanceof WebhookSignatureError) {
      return new Response("Invalid signature", { status: 401 });
    }
    throw error;
  }

  const event = JSON.parse(rawBody.toString("utf8")) as {
    id: string;
    type: string;
    payload: unknown;
  };
  const result = await handleWebhook(event, {
    store,
    getKey: (value) => value.id,
    handler: async () => {
      // Business work after the signature check.
    },
  });
  return Response.json({ result });
}
```

`request.text()` is the UTF-8 decoding of the same bytes. It verifies when the
signed body is that Unicode string. Use `arrayBuffer()` when you need the
original bytes. `headers.get` matches header names without case sensitivity.

## Providers

Every helper accepts `string | Buffer`. Pass the original `Buffer` from the HTTP
adapter. Parsing JSON and serializing it again can change the bytes that were
signed.

`previousSecrets` on the option types is documented in
[Signing-secret rotation](#signing-secret-rotation).

### Generic HMAC

```ts
import { verifyHmacSignature } from "webhook-safe";

declare const rawBody: Buffer;
declare const signatureHeader: string;
declare const secret: string;
declare const previousSecrets: readonly string[];

verifyHmacSignature(rawBody, signatureHeader, secret, {
  previousSecrets,
});
```

`signatureHeader` is a hex digest or `sha256=` plus that digest. A mismatch
throws `WebhookSignatureError`. There is no timestamp in this verifier.

### Stripe

`verifyStripeSignature` checks the `Stripe-Signature` header and returns a
boolean. The default tolerance is 300 seconds. A timestamp further from `now`
than `toleranceSeconds`, in either direction, returns `false`. Multiple `v1`
values are accepted when one matches. The signed content is the timestamp, a
full stop, and the raw body.

```ts
import { handleWebhook, parseStripeWebhook, type IdempotencyStore } from "webhook-safe";

declare const rawBody: Buffer;
declare const stripeSignatureHeader: string;
declare const store: IdempotencyStore;

const event = parseStripeWebhook(rawBody, stripeSignatureHeader, {
  secret: process.env.STRIPE_WEBHOOK_SECRET!,
  toleranceSeconds: 300,
});

const result = await handleWebhook(event, {
  store,
  getKey: (value) => value.id,
  handler: async (value) => {
    console.log(value.type);
  },
});
```

`parseStripeWebhook` verifies before parsing. It returns:

```ts
interface StripeWebhookEvent<T = unknown> {
  id: string;
  object: "event";
  type: string;
  data: {
    object: T;
  };
}
```

`T` is a TypeScript assertion. The runtime check requires `id`, `object: "event"`,
`type`, and `data.object`. It does not check fields inside `data.object`.

```ts
interface StripeSignatureOptions {
  secret: string;
  toleranceSeconds?: number;
  now?: number;
  previousSecrets?: readonly string[];
}
```

`now` is the current time in milliseconds. Use the Stripe event `id` as the
idempotency key. A bad signature makes `verifyStripeSignature` return `false`
and makes `parseStripeWebhook` throw `Error`.

### GitHub

GitHub signs the raw body with HMAC-SHA256. Pass `X-Hub-Signature-256`,
`X-GitHub-Event`, and `X-GitHub-Delivery`.

```ts
import { handleWebhook, parseGitHubWebhook, type IdempotencyStore } from "webhook-safe";

declare const rawBody: Buffer;
declare const signatureHeader: string;
declare const githubEventHeader: string;
declare const githubDeliveryHeader: string;
declare const store: IdempotencyStore;

const event = parseGitHubWebhook(rawBody, signatureHeader, {
  secret: process.env.GITHUB_WEBHOOK_SECRET!,
  event: githubEventHeader,
  deliveryId: githubDeliveryHeader,
});

const result = await handleWebhook(event, {
  store,
  getKey: (value) => value.deliveryId,
  handler: async (value) => {
    console.log(value.event);
  },
});
```

```ts
interface GitHubWebhookEvent<T = unknown> {
  deliveryId: string;
  event: string;
  payload: T;
}
```

`verifyGitHubSignature` requires a `sha256=` prefix. A missing prefix throws
`Error`. A digest mismatch throws `WebhookSignatureError`. `T` is an assertion.
The parser checks that the JSON value is an object, not the fields inside it.
Use `X-GitHub-Delivery` as the idempotency key.

### Shopify

Shopify signs the raw body with HMAC-SHA256 and sends a Base64 digest. Pass that
header, the topic, and the webhook id.

```ts
import { handleWebhook, parseShopifyWebhook, type IdempotencyStore } from "webhook-safe";

declare const rawBody: Buffer;
declare const shopifyHmacHeader: string;
declare const shopifyTopicHeader: string;
declare const shopifyWebhookIdHeader: string;
declare const store: IdempotencyStore;

const event = parseShopifyWebhook(rawBody, shopifyHmacHeader, {
  secret: process.env.SHOPIFY_WEBHOOK_SECRET!,
  topic: shopifyTopicHeader,
  webhookId: shopifyWebhookIdHeader,
});

const result = await handleWebhook(event, {
  store,
  getKey: (value) => value.webhookId,
  handler: async (value) => {
    console.log(value.topic);
  },
});
```

```ts
interface ShopifyWebhookEvent<T = unknown> {
  webhookId: string;
  topic: string;
  payload: T;
}
```

The signature must be canonical Base64 for a 32-byte digest, including the
trailing `=`. `T` is an assertion. The parser checks that the JSON value is an
object. Use the Shopify webhook id as the idempotency key. A bad signature throws
`WebhookSignatureError`.

### Slack Events API

Slack signs `v0:{timestamp}:{body}` with the app Signing Secret. Pass
`X-Slack-Signature` and `X-Slack-Request-Timestamp`. Turn Socket Mode off when
the app receives HTTP callbacks.

```ts
import { parseSlackWebhook } from "webhook-safe";

function acceptSlack(
  rawBody: Buffer,
  slackSignatureHeader: string,
  slackRequestTimestampHeader: string,
): string {
  const event = parseSlackWebhook(rawBody, slackSignatureHeader, {
    secret: process.env.SLACK_SIGNING_SECRET!,
    timestamp: slackRequestTimestampHeader,
  });

  if (event.type === "url_verification") {
    // Respond HTTP 200 with this JSON immediately.
    return JSON.stringify({ challenge: event.challenge });
  }

  const key = JSON.stringify([
    "slack",
    event.apiAppId,
    event.teamId,
    event.eventId,
  ]);
  // Durably enqueue `key` and `event`, then respond HTTP 200.
  return key;
}
```

```ts
type SlackWebhookEvent<T = Record<string, unknown>> =
  | { type: "url_verification"; challenge: string }
  | {
      type: "event_callback";
      eventId: string;
      teamId: string;
      apiAppId: string;
      event: T;
    };
```

`toleranceSeconds` narrows the window and must be from 0 through 300. The
default is 300. A timestamp more than that many seconds from `now`, in either
direction, throws `WebhookSignatureError`. `now` is milliseconds. The parser
accepts JSON `url_verification` and `event_callback` envelopes. It checks
`event.type`, not the rest of the event. Signed form bodies can be verified
with `verifySlackSignature`. They are not parsed. Socket Mode, OAuth,
slash-command parsing, and outbound notifications are outside this adapter.

Slack expects an acknowledgment within three seconds. Queue a callback durably
before responding, and do the business work in another consumer. An in-memory
claim is not durable acceptance. Deduplicate by the signed event identity.
Require one value for each signature and timestamp header.

See the [durable queue example](https://github.com/SiriusDreamz/webhook-safe/blob/master/examples/slack.ts)
and [Slack setup](https://github.com/SiriusDreamz/webhook-safe/blob/master/examples/slack.md).

### Standard Webhooks

This verifies [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md)
v1 signatures. Svix documents `svix-id`, `svix-timestamp`, and `svix-signature`
as the same values as `webhook-id`, `webhook-timestamp`, and `webhook-signature`.
Pass one complete set. Do not mix an id from one set with a signature from the
other.

The signed content is the id, a full stop, the Unix timestamp, a full stop, and
the raw body. The HMAC key is the base64-decoded secret, not the `whsec_`
prefix. The signature header is space-separated. Only `v1,<base64>` entries are
checked. Other versions, including `v2a`, are ignored. One matching `v1` is
enough, which is how senders rotate keys.

```ts
import { verifyStandardWebhookSignature } from "webhook-safe";

declare const rawBody: Buffer;
declare const headers: Headers;

const standardHeaders =
  headers.get("webhook-id") !== null ||
  headers.get("webhook-timestamp") !== null ||
  headers.get("webhook-signature") !== null;

verifyStandardWebhookSignature(
  rawBody,
  standardHeaders
    ? headers.get("webhook-signature") ?? ""
    : headers.get("svix-signature") ?? "",
  {
    secret: process.env.STANDARD_WEBHOOKS_SECRET!,
    id: standardHeaders
      ? headers.get("webhook-id") ?? ""
      : headers.get("svix-id") ?? "",
    timestamp: standardHeaders
      ? headers.get("webhook-timestamp") ?? ""
      : headers.get("svix-timestamp") ?? "",
  },
);
```

```ts
interface StandardWebhookSignatureOptions {
  secret: string;
  id: string;
  timestamp: string;
  toleranceSeconds?: number;
  now?: number;
  previousSecrets?: readonly string[];
}
```

`toleranceSeconds` defaults to 300. The comparison uses whole seconds:
`abs(floor(now / 1000) - timestamp) <= toleranceSeconds`. `now` is milliseconds.
Ids that contain `.`, whitespace, or NUL are rejected. The secret is `whsec_`
plus canonical standard base64, or that base64 without the prefix. The
specification recommends 24 to 64 decoded bytes. This function rejects empty and
non-canonical secrets and does not enforce that range.

The specification keeps `webhook-id` stable across retries. Use it as the
idempotency key. There is no separate package to install.

### Paddle Billing

[Paddle Billing](https://developer.paddle.com/webhooks/about/signature-verification)
sends `Paddle-Signature`. The signed content is the `ts` value, a colon, and the
raw body. The endpoint secret string is the HMAC key. It is not base64-decoded.
The header has one canonical Unix `ts` and one or more lowercase 64-character
`h1` digests, separated by semicolons. Paddle's documentation says more than one
`h1` is returned during secret rotation. Any matching `h1` is enough when every
`h1` is well formed.

```ts
import { verifyPaddleSignature } from "webhook-safe";

declare const rawBody: Buffer;
declare const paddleSignatureHeader: string;

verifyPaddleSignature(rawBody, paddleSignatureHeader, {
  secret: process.env.PADDLE_WEBHOOK_SECRET!,
});
```

```ts
interface PaddleSignatureOptions {
  secret: string;
  toleranceSeconds?: number;
  now?: number;
  previousSecrets?: readonly string[];
}
```

`toleranceSeconds` defaults to 5. The absolute difference between `now` and
`ts * 1000` must be less than or equal to `toleranceSeconds * 1000`. Older and
future timestamps are rejected. Exactly five seconds of skew is accepted at the
default. A larger tolerance widens the window. `now` is milliseconds.

Paddle documents `event_id` as the event identity and `notification_id` as the
delivery attempt. Read both from the verified JSON. Use `event_id` as the
idempotency key. See [How webhooks work](https://developer.paddle.com/webhooks/about/how-webhooks-work).

### Lemon Squeezy

[Lemon Squeezy](https://docs.lemonsqueezy.com/help/webhooks/signing-requests)
sends the lowercase hex HMAC-SHA256 of the raw body in `X-Signature`. There is
no timestamp. The documented Node example compares that hex string in constant
time. This function checks the length before `timingSafeEqual`, so a short
header throws `WebhookSignatureError` rather than `RangeError`.

`X-Event-Name` is not part of the HMAC. The
[webhook request](https://docs.lemonsqueezy.com/help/webhooks/webhook-requests)
example body includes `meta.event_name` and `data.id`. Read those from the
verified JSON. Lemon Squeezy retries a delivery that does not respond with
HTTP 200.

```ts
import { verifyLemonSqueezySignature } from "webhook-safe";

declare const rawBody: Buffer;
declare const signatureHeader: string;

verifyLemonSqueezySignature(rawBody, signatureHeader, {
  secret: process.env.LEMONSQUEEZY_WEBHOOK_SECRET!,
});
```

```ts
interface LemonSqueezySignatureOptions {
  secret: string;
  previousSecrets?: readonly string[];
}
```

The signing secret is a string you choose on the webhook. The docs describe it
as any string, normally 6 to 40 characters. This function requires a nonempty
string and does not enforce that usual length. It does not base64-decode the
secret. The provider docs show one signature, not a list.

## Idempotency

`handleWebhook` claims an event, runs the handler, and marks it completed.

```ts
import { handleWebhook, type IdempotencyStore, type WebhookEvent } from "webhook-safe";

declare const store: IdempotencyStore;
declare const event: WebhookEvent;

const result = await handleWebhook(event, {
  store,
  getKey: (value) => value.id,
  handler: async () => {
    // Process the event.
  },
  leaseMs: 5 * 60 * 1000,
});
```

```ts
import type { IdempotencyStore } from "webhook-safe";

interface WebhookHandlerOptions<T> {
  store: IdempotencyStore;
  getKey: (event: T) => string;
  handler: (event: T) => Promise<void>;
  leaseMs?: number;
}
```

The return type is `Promise<"processed" | "duplicate">`. A new claim is
processed once. A key that is already claimed or completed returns `"duplicate"`.
If the handler throws, the claim is released so a later delivery can retry.

```text
webhook received -> claim -> handler -> completed
webhook received -> already claimed or completed -> "duplicate"
webhook received -> claim -> handler throws -> release -> provider can retry
```

`isWebhookEvent` checks the generic shape used with a handler you parse yourself:

```ts
interface WebhookEvent {
  id: string;
  type: string;
  payload: unknown;
}
```

`id` and `type` must be strings, and `payload` must be present. The helper does
not require those strings to be nonempty.

### Leases and retries

The default `leaseMs` is 300000 (5 minutes). It must be a finite number greater
than 0. While the handler is running, the library renews the claim. Renewal
succeeds only for the current owner. If renewal fails, `handleWebhook` rejects
and does not report `"processed"`.

A worker that disappears without completing or releasing the claim can be
retried after the lease expires. A synchronous throw and a rejected handler
promise both release the claim. An in-flight renewal settles before completion
or release. If processing and release both fail, an `AggregateError` contains
both failures and sets the processing failure as `cause`. A failed release can
leave the claim held until expiry. Bound store operations with timeouts in your
application.

Lease loss does not cancel work the handler has already started, and a late
handler does not mark the event completed through that call. Downstream side
effects still need their own idempotency. This library does not provide a
durable queue.

For more than one application instance, use `RedisStore` or `PostgresStore`.
Verify the signature before `handleWebhook`. Keep the idempotency key stable
across the keys in a rotation overlap. The provider sections name the id to use.

### MemoryStore

```ts
import { MemoryStore } from "webhook-safe";

const store = new MemoryStore();
```

Completed keys stay in the `MemoryStore` instance until that object is
discarded. Use it for development, tests, examples, and a single process.

### RedisStore

```ts
import { createClient } from "redis";
import { RedisStore } from "webhook-safe";

const client = createClient({ url: process.env.REDIS_URL });
await client.connect();

const store = new RedisStore(client, "webhook-safe:", 24 * 60 * 60 * 1000);
```

Arguments are the Redis client, the key prefix, and the completed-event
retention in milliseconds. The prefix defaults to `"webhook-safe:"`. Retention
defaults to 86400000 milliseconds (24 hours). Passing
`7 * 24 * 60 * 60 * 1000` keeps completed keys for 7 days. That value is an
argument, not a second default.

Processing claims use Redis expiration. Claim, renew, release, and complete use
atomic commands and ownership-checked Lua scripts. The integration tests call a
Redis server when `REDIS_URL` is set.

### PostgresStore

```ts
import { Pool } from "pg";
import { POSTGRES_STORE_SCHEMA, PostgresStore } from "webhook-safe";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(POSTGRES_STORE_SCHEMA);

const store = new PostgresStore(pool, 24 * 60 * 60 * 1000);
```

`POSTGRES_STORE_SCHEMA` is:

```sql
CREATE TABLE IF NOT EXISTS webhook_safe_events (
  key TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('processing', 'completed')
  ),
  expires_at TIMESTAMPTZ NOT NULL
);
```

The constructor takes a `pg` client or pool and the completed-event retention in
milliseconds. The default retention is 86400000 milliseconds (24 hours). Claim,
renew, release, and complete use `INSERT ... ON CONFLICT` and ownership-checked
`UPDATE` and `DELETE`. An expired row does not have to be deleted before its key
can be claimed again. The integration tests call PostgreSQL when `POSTGRES_URL`
is set.

### Custom stores

```ts
import type {
  EventStatus,
  IdempotencyClaim,
  IdempotencyStore,
} from "webhook-safe";

class CustomStore implements IdempotencyStore {
  async get(_key: string): Promise<EventStatus | null> {
    return null;
  }

  async claim(_key: string, _leaseMs: number): Promise<IdempotencyClaim | null> {
    return null;
  }

  async renew(
    _key: string,
    _claim: IdempotencyClaim,
    _leaseMs: number,
  ): Promise<boolean> {
    return false;
  }

  async release(_key: string, _claim: IdempotencyClaim): Promise<void> {}

  async setCompleted(_key: string, _claim: IdempotencyClaim): Promise<void> {}
}
```

Use atomic ownership checks where the datastore supports them. `setCompleted`
resolves only after recording completion for an unexpired claim owned by that
token. Reject when the claim is missing, expired, or owned by someone else, and
on a store error. `handleWebhook` cannot see a store that skips the write and
still resolves.

### Completion acknowledgement (0.8.1+)

Since 0.8.1, `MemoryStore`, `RedisStore`, and `PostgresStore` reject
`setCompleted` with `WebhookError` when the processing claim is missing,
expired, already completed, or owned by another worker. `handleWebhook`
propagates that failure instead of returning `"processed"`. Cleanup checks
ownership and does not release a replacement worker's claim. Store and network
errors also propagate. A failed write can have an uncertain outcome.

The handler may already have performed its side effects. This error does not
roll those effects back. Do not turn it into a success response without
reviewing them. This behavior is not part of 0.8.0.

## Signing-secret rotation

Signing-secret rotation is available in 0.8.0 and later.

Keep `secret` as the current key and pass up to two older keys in
`previousSecrets`:

```ts
import { parseStripeWebhook, verifyHmacSignature } from "webhook-safe";

declare const rawBody: Buffer;
declare const stripeSignatureHeader: string;
declare const signatureHeader: string;
declare const currentSecret: string;
declare const previousSecret: string;

const event = parseStripeWebhook(rawBody, stripeSignatureHeader, {
  secret: currentSecret,
  previousSecrets: [previousSecret],
});

verifyHmacSignature(rawBody, signatureHeader, currentSecret, {
  previousSecrets: [previousSecret],
});
```

Stripe, GitHub, Shopify, and Slack verification and parsing have accepted this
option since 0.8.0. The 0.10.0 Standard Webhooks, Paddle Billing, and Lemon
Squeezy verifiers accept it too.

An omitted or empty list uses only the current secret. When the list is
present, it must contain at most two distinct nonempty strings, each different
from the current secret, and the current secret must be nonempty. Invalid
configuration throws `Error` with a fixed message that does not include key
material. Every configured key is checked. The result does not say which key
matched. That is not a general constant-time execution guarantee.

You choose the overlap window. The library does not store secrets, change
provider settings, or expire old keys. Remove a previous key when deliveries
signed with it should stop verifying. Timestamp tolerances still apply to every
key. Lemon Squeezy signatures have no timestamp, so rotation does not add replay
protection there. Deduplicate with the same event or delivery id for every key.

Standard Webhooks can also carry several space-separated `v1` signatures, and
Paddle can carry several `h1` values. Those header lists are checked in addition
to `previousSecrets`.

See [examples/secret-rotation.ts](examples/secret-rotation.ts). Rotation in this
package does not change hosted Cloud secret controls.

## API reference

Signatures below match the exports in `src/index.ts`. Behavior is in the
sections linked from [Contents](#contents).

```ts
import type {
  CloudSignatureOptions,
  GitHubSignatureOptions,
  GitHubWebhookEvent,
  LemonSqueezySignatureOptions,
  PaddleSignatureOptions,
  ParseGitHubWebhookOptions,
  ParseShopifyWebhookOptions,
  ParseSlackWebhookOptions,
  ParseStripeWebhookOptions,
  ShopifySignatureOptions,
  ShopifyWebhookEvent,
  SigningSecretRotationOptions,
  SlackSignatureOptions,
  SlackWebhookEvent,
  StandardWebhookSignatureOptions,
  StripeSignatureOptions,
  StripeWebhookEvent,
  WebhookEvent,
  WebhookHandlerOptions,
} from "webhook-safe";

declare function handleWebhook<T>(
  event: T,
  options: WebhookHandlerOptions<T>,
): Promise<"processed" | "duplicate">;

declare function verifyHmacSignature(
  payload: string | Buffer,
  signature: string,
  secret: string,
  options?: SigningSecretRotationOptions,
): void;

declare function verifyStripeSignature(
  payload: string | Buffer,
  signatureHeader: string,
  options: StripeSignatureOptions,
): boolean;

declare function parseStripeWebhook<T = unknown>(
  payload: string | Buffer,
  signatureHeader: string,
  options: ParseStripeWebhookOptions,
): StripeWebhookEvent<T>;

declare function verifyGitHubSignature(
  payload: string | Buffer,
  signatureHeader: string,
  options: GitHubSignatureOptions,
): void;

declare function parseGitHubWebhook<T = unknown>(
  payload: string | Buffer,
  signatureHeader: string,
  options: ParseGitHubWebhookOptions,
): GitHubWebhookEvent<T>;

declare function verifyShopifySignature(
  payload: string | Buffer,
  signatureHeader: string,
  options: ShopifySignatureOptions,
): void;

declare function parseShopifyWebhook<T = unknown>(
  payload: string | Buffer,
  signatureHeader: string,
  options: ParseShopifyWebhookOptions,
): ShopifyWebhookEvent<T>;

declare function verifySlackSignature(
  payload: string | Buffer,
  signatureHeader: string,
  options: SlackSignatureOptions,
): void;

declare function parseSlackWebhook<T = Record<string, unknown>>(
  payload: string | Buffer,
  signatureHeader: string,
  options: ParseSlackWebhookOptions,
): SlackWebhookEvent<T>;

declare function verifyStandardWebhookSignature(
  payload: string | Buffer,
  signatureHeader: string,
  options: StandardWebhookSignatureOptions,
): void;

declare function verifyPaddleSignature(
  payload: string | Buffer,
  signatureHeader: string,
  options: PaddleSignatureOptions,
): void;

declare function verifyLemonSqueezySignature(
  payload: string | Buffer,
  signatureHeader: string,
  options: LemonSqueezySignatureOptions,
): void;

declare function verifyCloudSignature(
  payload: string | Buffer,
  signatureHeader: string,
  options: CloudSignatureOptions,
): void;

declare function isWebhookEvent(value: unknown): value is WebhookEvent;
```

`SigningSecretRotationOptions` is `{ previousSecrets?: readonly string[] }`.
Provider option interfaces extend it and add the fields listed in each provider
section. `ParseStripeWebhookOptions` has the same fields as
`StripeSignatureOptions`. `ParseGitHubWebhookOptions` adds `event` and
`deliveryId`. `ParseShopifyWebhookOptions` adds `topic` and `webhookId`.
`ParseSlackWebhookOptions` is `SlackSignatureOptions`.

```ts
import type { Pool, PoolClient } from "pg";
import type { RedisClientType } from "redis";
import type { IdempotencyStore } from "webhook-safe";

interface SlackSignatureOptions {
  secret: string;
  timestamp: string;
  toleranceSeconds?: number;
  now?: number;
  previousSecrets?: readonly string[];
}

interface CloudSignatureOptions {
  secret: string;
  deliveryId: string;
  timestamp: string;
  toleranceSeconds?: number;
  now?: number;
  previousSecrets?: readonly string[];
}

type MemoryStoreConstructor = new () => IdempotencyStore;

type RedisStoreConstructor = new (
  client: RedisClientType,
  prefix?: string,
  completedTtlMs?: number,
) => IdempotencyStore;

type PostgresStoreConstructor = new (
  client: Pick<Pool | PoolClient, "query">,
  completedTtlMs?: number,
) => IdempotencyStore;
```

`RedisClientType` comes from the `redis` package. `Pool` and `PoolClient` come
from `pg`. `POSTGRES_STORE_SCHEMA` is the exported SQL string.
`WebhookError` and `WebhookSignatureError` are exported classes.
`WebhookSignatureError` extends `WebhookError`. Its default message is
`"Invalid webhook signature"`.

Also exported: `EventStatus` (`"processing" | "completed"`), `IdempotencyClaim`
(`{ token: string }`), and `IdempotencyStore`.

## Security

Verify the signature before parsing or doing business work. Pass the original
body bytes. All signature helpers take `string | Buffer`. Decoding those bytes
and encoding them again can change the signed content. Parsers verify before
they decode JSON. They do not validate provider-specific fields beyond the
envelopes described above.

Digest comparison uses `crypto.timingSafeEqual` after a length check. A short or
malformed header is rejected before that call. Every configured secret and every
well-formed candidate signature is compared. The boolean result does not reveal
which one matched.

Stripe timestamps are unambiguous non-negative decimal integers. Duplicate `t`
fields, fractions, exponents, signs, and a digest that is not 64 hex characters
are rejected. `now` must be finite and greater than or equal to 0. The signing
secret must be nonempty. Standard Webhooks timestamps use that same decimal
form, and the tolerance is applied to whole seconds. Paddle's `ts` uses that
form too. Its default tolerance is five seconds, measured in milliseconds, in
both directions. A Standard Webhooks secret must be canonical base64, with or
without one `whsec_` prefix. Lemon Squeezy accepts a 64-character lowercase hex
digest and has no timestamp check. Shopify accepts canonical Base64 for the
32-byte digest, including the final `=`.

Do not log signing secrets or send them to a browser. Adding `previousSecrets`
does not widen a provider's timestamp window.

## Library or hosted service

Use this package to verify and deduplicate webhooks in your own application. It
does not create an endpoint, queue, or hosted delivery worker. For managed
ingestion, forwarding, retries, and event inspection, see the separate
[Webhook Safe Cloud documentation](https://www.webhook-safe.com/docs).

## Cloud delivery verification

`verifyCloudSignature` is prepared for 0.9.0. It is not exported by published
0.8.1. Cloud delivery signing also requires its own approved rollout and
per-endpoint setup. Do not assume current hosted deliveries have these headers.

After rollout, configure a separate random delivery signing key of at least 32
bytes in the receiver and in the Cloud endpoint. Do not reuse the provider
signing key. The helper throws `WebhookSignatureError` for an invalid signature,
timestamp, or identity, and returns void on success. Configuration errors throw
`Error`.

```ts
import { verifyCloudSignature } from "webhook-safe";

declare const rawBody: Buffer;
declare const signatureHeader: string;
declare const deliverySigningSecret: string;
declare const webhookSafeId: string;
declare const webhookSafeTimestamp: string;

verifyCloudSignature(rawBody, signatureHeader, {
  secret: deliverySigningSecret,
  deliveryId: webhookSafeId,
  timestamp: webhookSafeTimestamp,
});
```

The HTTP adapter must bound the raw body and header sizes, require one
`webhook-safe-id` value and one `webhook-safe-timestamp` value, and pass the
combined `webhook-safe-signature` value unchanged. Preserve the original
`Buffer` before JSON middleware. Duplicate identity or timestamp headers are
rejected when they are joined. Cloud uses one signature header with up to two
`v1` candidates during overlap. The verifier accepts at most three candidates
and 206 characters, which covers up to two configured previous verifier keys.

The signed message is the UTF-8 text `v1\n{timestamp}\n{deliveryId}\n` followed
by the original body bytes. Candidates are lowercase hex HMAC-SHA256 digests in
the form `v1=<digest>`, separated by commas. The identity is the canonical
lowercase Cloud event UUID. The timestamp is canonical Unix seconds. It is
regenerated for each attempt. The identity stays the same across retries and
manual replay. Content-Type, the URL, and other headers are not covered by this
signature.

The default tolerance is 300 seconds in either direction. `toleranceSeconds`
may be from 0 through 300. `now` is a finite, non-negative clock in
milliseconds, mainly for tests. Verification does not make a replayed delivery
new. Deduplicate the verified identity in a shared store, and make downstream
side effects idempotent. A normal replay keeps the identity, so the receiver
still treats it as a duplicate unless the application arranges its own recovery.
See [examples/cloud.ts](examples/cloud.ts).

For key rotation, deploy the receiver so it accepts the next key first. Cloud
can sign with the current and previous keys for up to 24 hours, then stops using
the old key. Remove previous verifier keys after that overlap and the
in-flight timestamp window. Revoking a key does not retract a request that was
already signed and is still in flight. This library reads secrets from
application configuration. It does not store, generate, or expire them.
`previousSecrets` may be passed on `CloudSignatureOptions`.

## Roadmap

Possible later work:

- replay tooling
- framework integrations
- an operational dashboard

## License

MIT
