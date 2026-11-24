# webhook-safe

Webhook signature verification and idempotent processing for Node.js and TypeScript.

Verify Stripe, GitHub, Shopify, Slack Events API, Standard Webhooks, Paddle Billing,
Lemon Squeezy and generic HMAC webhooks, then coordinate duplicate-event processing
with in-memory, Redis or PostgreSQL stores. The library is framework agnostic;
preserve raw request bytes in your HTTP adapter.

Standard Webhooks, Paddle Billing and Lemon Squeezy verification is prepared for
0.10.0 and documented below. Published 0.9.0 does not export these verifiers.

For managed webhook delivery, retries and event inspection, visit
[Webhook Safe Cloud](https://www.webhook-safe.com).

**Guides:** [Installation](#installation) · [Basic usage](#basic-usage) ·
[Stripe](#stripe-webhooks) · [GitHub](#github-webhooks) ·
[Shopify](#shopify-webhooks) · [Slack](#slack-events-api) ·
[Standard Webhooks](#standard-webhooks) · [Paddle](#paddle-billing) ·
[Lemon Squeezy](#lemon-squeezy) ·
[Stores](#stores) · [API](#api) · [Security](#security)

See the [version history](CHANGELOG.md) for new features and release status.

## Features

- Redis-backed idempotency
- PostgreSQL-backed idempotency
- Duplicate event protection
- Atomic event claiming
- Automatically renewed processing leases
- Retry after handler failure
- Retry after abandoned processing
- Ownership-safe completion and release
- Stripe webhook signature verification
- Stripe webhook event parsing
- Stripe timestamp tolerance and replay protection
- GitHub webhook signature verification
- GitHub webhook event parsing
- GitHub delivery ID support for idempotency
- Shopify webhook signature verification
- Shopify webhook event parsing
- Shopify webhook ID support for idempotency
- Slack request signature verification with a five-minute timestamp window
- Slack Events API callback parsing and signed URL-verification challenges
- Standard Webhooks v1 HMAC-SHA256 verification, including Svix `svix-*` header values
- Paddle Billing `Paddle-Signature` verification with a replay window
- Lemon Squeezy `X-Signature` HMAC-SHA256 verification
- Generic HMAC-SHA256 signature verification
- Supports raw hexadecimal and `sha256=<hex>` signatures
- Timing-safe signature comparison
- Runtime webhook event validation
- TypeScript support
- Framework agnostic
- Custom idempotency store support
- In-memory `MemoryStore`
- Redis-backed `RedisStore`
- PostgreSQL-backed `PostgresStore`
- Configurable completed-event retention

## Installation

```bash
npm install webhook-safe
```

`MemoryStore` requires no additional dependencies.

For Redis:

```bash
npm install redis
```

For PostgreSQL:

```bash
npm install pg
```

## Basic usage

```ts
import { handleWebhook, MemoryStore, verifyHmacSignature } from "webhook-safe";

const store = new MemoryStore();

const rawBody = JSON.stringify({
  id: "event_123",
  type: "payment.created",
  payload: {
    amount: 1000,
  },
});

verifyHmacSignature(rawBody, "sha256=your-signature", "your-webhook-secret");

const event = JSON.parse(rawBody);

const result = await handleWebhook(event, {
  store,
  getKey: (event) => event.id,
  handler: async (event) => {
    console.log("Processing webhook:", event);
  },
});

console.log(result);
```

`handleWebhook` returns:

```ts
"processed" | "duplicate";
```

A new event is processed once:

```text
webhook received
  ↓
claim event
  ↓
process handler
  ↓
mark completed
```

A duplicate delivery is ignored:

```text
webhook received
  ↓
event already claimed or completed
  ↓
return "duplicate"
```

If the handler fails:

```text
webhook received
  ↓
claim event
  ↓
handler throws
  ↓
release event
  ↓
provider can retry
```

## Stripe webhooks

`webhook-safe` includes dependency-free helpers for verifying and parsing Stripe webhooks.

A typical Stripe webhook can be handled with:

```ts
import { handleWebhook, MemoryStore, parseStripeWebhook } from "webhook-safe";

const store = new MemoryStore();

const event = parseStripeWebhook(rawBody, stripeSignatureHeader, {
  secret: process.env.STRIPE_WEBHOOK_SECRET!,
});

const result = await handleWebhook(event, {
  store,
  getKey: (event) => event.id,
  handler: async (event) => {
    console.log("Processing Stripe event:", event.type);
  },
});
```

The raw request body must be preserved for Stripe signature verification. Do not parse and re-serialize the request body before calling `parseStripeWebhook`.

### Stripe signature verification

If you only need signature verification:

```ts
import { verifyStripeSignature } from "webhook-safe";

const valid = verifyStripeSignature(rawBody, stripeSignatureHeader, {
  secret: process.env.STRIPE_WEBHOOK_SECRET!,
});

if (!valid) {
  throw new Error("Invalid Stripe webhook signature");
}
```

Stripe signatures include a timestamp. By default, signatures outside a **5-minute tolerance** are rejected.

You can configure the tolerance:

```ts
const valid = verifyStripeSignature(rawBody, stripeSignatureHeader, {
  secret: process.env.STRIPE_WEBHOOK_SECRET!,
  toleranceSeconds: 600,
});
```

Multiple `v1` signatures in the `Stripe-Signature` header are supported. The signature is accepted if any `v1` signature matches.

### Stripe event parsing

`parseStripeWebhook` verifies the signature before parsing the event.

```ts
const event = parseStripeWebhook(rawBody, stripeSignatureHeader, {
  secret: process.env.STRIPE_WEBHOOK_SECRET!,
});
```

It validates the minimum Stripe event envelope:

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

You can provide a type for `data.object`:

```ts
interface PaymentIntent {
  id: string;
  amount: number;
}

const event = parseStripeWebhook<PaymentIntent>(
  rawBody,
  stripeSignatureHeader,
  {
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
  },
);

console.log(event.data.object.amount);
```

The generic type is a TypeScript type assertion for your application. `webhook-safe` validates the Stripe event envelope at runtime, but it does not validate provider-specific fields inside `data.object`.

Using the Stripe event ID as the idempotency key prevents repeated Stripe deliveries from executing your handler multiple times:

```ts
await handleWebhook(event, {
  store,
  getKey: (event) => event.id,
  handler: async (event) => {
    await processStripeEvent(event);
  },
});
```

## GitHub webhooks

`webhook-safe` includes helpers for verifying and parsing GitHub webhooks.

GitHub signs webhook deliveries using HMAC-SHA256. The signature is provided in the `X-Hub-Signature-256` header.

GitHub also provides:

- `X-GitHub-Event` — the webhook event name
- `X-GitHub-Delivery` — a unique delivery identifier

A typical GitHub webhook can be handled with:

```ts
import { handleWebhook, MemoryStore, parseGitHubWebhook } from "webhook-safe";

const store = new MemoryStore();

const event = parseGitHubWebhook(rawBody, signatureHeader, {
  secret: process.env.GITHUB_WEBHOOK_SECRET!,
  event: githubEventHeader,
  deliveryId: githubDeliveryHeader,
});

const result = await handleWebhook(event, {
  store,
  getKey: (event) => event.deliveryId,
  handler: async (event) => {
    console.log("Processing GitHub event:", event.event);
    console.log(event.payload);
  },
});
```

Use the GitHub delivery ID as the idempotency key. Repeated delivery of the same GitHub webhook can then be rejected by the idempotency store.

As with other signed webhook providers, preserve the exact raw request body used to calculate the signature.

### GitHub signature verification

If you only need signature verification:

```ts
import { verifyGitHubSignature } from "webhook-safe";

verifyGitHubSignature(rawBody, signatureHeader, {
  secret: process.env.GITHUB_WEBHOOK_SECRET!,
});
```

`verifyGitHubSignature` expects the GitHub `sha256=<hex>` signature format.

A valid signature returns normally. An invalid signature throws `WebhookSignatureError`.

### GitHub event parsing

`parseGitHubWebhook` verifies the signature before parsing the payload.

```ts
const event = parseGitHubWebhook(rawBody, signatureHeader, {
  secret: process.env.GITHUB_WEBHOOK_SECRET!,
  event: githubEventHeader,
  deliveryId: githubDeliveryHeader,
});
```

It returns:

```ts
interface GitHubWebhookEvent<T = unknown> {
  deliveryId: string;
  event: string;
  payload: T;
}
```

The event name corresponds to GitHub's `X-GitHub-Event` header, and `deliveryId` corresponds to `X-GitHub-Delivery`.

You can provide a type for the parsed payload:

```ts
interface PullRequestPayload {
  action: string;
  repository: {
    id: number;
    full_name: string;
  };
}

const event = parseGitHubWebhook<PullRequestPayload>(rawBody, signatureHeader, {
  secret: process.env.GITHUB_WEBHOOK_SECRET!,
  event: githubEventHeader,
  deliveryId: githubDeliveryHeader,
});

console.log(event.payload.action);
console.log(event.payload.repository.full_name);
```

The generic type is a TypeScript type assertion for your application. `webhook-safe` verifies that the payload is a JSON object, but it does not validate provider-specific fields inside the GitHub payload.

Using `deliveryId` with `handleWebhook` prevents the same GitHub delivery from executing your handler multiple times:

```ts
await handleWebhook(event, {
  store,
  getKey: (event) => event.deliveryId,
  handler: async (event) => {
    await processGitHubEvent(event);
  },
});
```

## Shopify webhooks

`webhook-safe` includes helpers for verifying and parsing Shopify webhooks.

Shopify signs webhook payloads using HMAC-SHA256. Pass the Shopify HMAC signature header to `verifyShopifySignature` or `parseShopifyWebhook`.

For idempotency, pass the webhook topic and Shopify webhook ID from the incoming request headers to `parseShopifyWebhook`.

A typical Shopify webhook can be handled with:

```ts
import { handleWebhook, MemoryStore, parseShopifyWebhook } from "webhook-safe";

const store = new MemoryStore();

const event = parseShopifyWebhook(rawBody, shopifyHmacHeader, {
  secret: process.env.SHOPIFY_WEBHOOK_SECRET!,
  topic: shopifyTopicHeader,
  webhookId: shopifyWebhookIdHeader,
});

const result = await handleWebhook(event, {
  store,
  getKey: (event) => event.webhookId,
  handler: async (event) => {
    console.log("Processing Shopify event:", event.topic);
    console.log(event.payload);
  },
});
```

Use the Shopify webhook ID as the idempotency key. Repeated delivery of the same Shopify webhook can then be rejected by the idempotency store.

Preserve the exact raw request body used to calculate the Shopify signature. Do not parse and re-serialize the body before signature verification.

### Shopify signature verification

If you only need signature verification:

```ts
import { verifyShopifySignature } from "webhook-safe";

verifyShopifySignature(rawBody, shopifyHmacHeader, {
  secret: process.env.SHOPIFY_WEBHOOK_SECRET!,
});
```

`verifyShopifySignature` computes the HMAC-SHA256 digest of the raw payload and compares it with Shopify's Base64-encoded signature using a timing-safe comparison.

A valid signature returns normally. An invalid signature throws `WebhookSignatureError`.

### Shopify event parsing

`parseShopifyWebhook` verifies the signature before parsing the payload.

```ts
const event = parseShopifyWebhook(rawBody, shopifyHmacHeader, {
  secret: process.env.SHOPIFY_WEBHOOK_SECRET!,
  topic: shopifyTopicHeader,
  webhookId: shopifyWebhookIdHeader,
});
```

It returns:

```ts
interface ShopifyWebhookEvent<T = unknown> {
  webhookId: string;
  topic: string;
  payload: T;
}
```

You can provide a type for the parsed payload:

```ts
interface OrderPayload {
  id: number;
  email: string;
  total_price: string;
}

const event = parseShopifyWebhook<OrderPayload>(rawBody, shopifyHmacHeader, {
  secret: process.env.SHOPIFY_WEBHOOK_SECRET!,
  topic: shopifyTopicHeader,
  webhookId: shopifyWebhookIdHeader,
});

console.log(event.payload.id);
console.log(event.payload.total_price);
```

The generic type is a TypeScript type assertion for your application. `webhook-safe` verifies that the Shopify payload is a JSON object, but it does not validate topic-specific fields inside the payload.

Using `webhookId` with `handleWebhook` prevents the same Shopify delivery from executing your handler multiple times:

```ts
await handleWebhook(event, {
  store,
  getKey: (event) => event.webhookId,
  handler: async (event) => {
    await processShopifyEvent(event);
  },
});
```

## Slack Events API

`webhook-safe` includes helpers for verifying Slack requests and parsing Events API webhooks.

Slack provides `X-Slack-Signature` and `X-Slack-Request-Timestamp` headers. Use the
Signing Secret from your app's Basic Information page, and turn Socket Mode off
when receiving HTTP callbacks.

A typical Slack webhook can be parsed with:

```ts
import { parseSlackWebhook } from "webhook-safe";

const event = parseSlackWebhook(rawBody, slackSignatureHeader, {
  secret: process.env.SLACK_SIGNING_SECRET!,
  timestamp: slackRequestTimestampHeader,
});

if (event.type === "url_verification") {
  // Respond HTTP 200 with JSON { challenge: event.challenge } immediately.
} else {
  const key = JSON.stringify(["slack", event.apiAppId, event.teamId, event.eventId]);
  // Durably enqueue/deduplicate key + event, then respond HTTP 200.
}
```

Preserve the exact raw request body and require one value for each signature and
timestamp header. Slack expects an acknowledgment within three seconds: durably
queue callbacks before responding and process business work in a separate consumer.
A detached promise or in-memory claim is not durable acceptance. Deduplicate by
signed event identity, not retry headers; an earlier delivery may have failed.

### Slack signature verification

If you only need signature verification:

```ts
import { verifySlackSignature } from "webhook-safe";

verifySlackSignature(rawBody, slackSignatureHeader, {
  secret: process.env.SLACK_SIGNING_SECRET!,
  timestamp: slackRequestTimestampHeader,
});
```

A valid signature returns normally. Invalid signatures or timestamps more than
five minutes from the clock throw `WebhookSignatureError`. `toleranceSeconds` can
narrow this window (0–300); `now` accepts a test clock in milliseconds. Invalid
configuration throws. Never parse and re-serialize the body before verification.

### Slack event parsing

`parseSlackWebhook` verifies the signature before parsing. It returns:

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

The generic type is a TypeScript assertion. The parser validates the envelope and
`event.type`, not event-specific fields. Validate those fields in your consumer.
Signed form requests can be verified, but the parser handles only JSON
`event_callback` and `url_verification`. Socket Mode, OAuth, slash-command parsing
and outbound notifications are outside this adapter.

See the [durable queue example](https://github.com/SiriusDreamz/webhook-safe/blob/master/examples/slack.ts)
and [Slack setup and troubleshooting](https://github.com/SiriusDreamz/webhook-safe/blob/master/examples/slack.md)
for HTTP configuration, challenge responses and retry handling.

## Standard Webhooks

`webhook-safe` verifies [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md) v1 signatures. The same values are used by Svix-based senders. Svix documents `svix-id`, `svix-timestamp` and `svix-signature` as aliases of `webhook-id`, `webhook-timestamp` and `webhook-signature`.

There is no separate package to install. The verifier is exported from `webhook-safe` and does not depend on Express, Next.js or a provider SDK.

The signed content is `webhook-id`, a full stop, the Unix timestamp, a full stop, and the raw body bytes. The HMAC key is the base64-decoded secret, not the `whsec_` prefix. The signature header is a space-separated list of versioned signatures. This verifier checks `v1,<base64>` HMAC-SHA256 signatures. Other versions in that list, including `v2a`, are ignored. A header with no matching `v1` signature fails.

Pass one complete header set. Do not mix `webhook-id` from one request with `svix-signature` from another.

### Raw body

Preserve the exact request bytes. Parsing JSON and serializing it again changes the signed content.

```ts
import { verifyStandardWebhookSignature } from "webhook-safe";

verifyStandardWebhookSignature(rawBody, signatureHeader, {
  secret: process.env.STANDARD_WEBHOOKS_SECRET!,
  id: webhookId,
  timestamp: webhookTimestamp,
});
```

`rawBody` is a `string` or `Buffer`. Pass the original `Buffer` when the HTTP adapter gives you bytes.

### Express

Mount a raw parser for this route only. Do not use `express.json()` before verification.

```ts
import express from "express";
import { verifyStandardWebhookSignature, WebhookSignatureError } from "webhook-safe";

const app = express();

app.post(
  "/webhooks/standard",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const standardHeaders = req.header("webhook-id") !== undefined
      || req.header("webhook-timestamp") !== undefined
      || req.header("webhook-signature") !== undefined;
    const signature = standardHeaders
      ? req.header("webhook-signature") ?? ""
      : req.header("svix-signature") ?? "";
    try {
      verifyStandardWebhookSignature(req.body, signature, {
        secret: process.env.STANDARD_WEBHOOKS_SECRET!,
        id: standardHeaders
          ? req.header("webhook-id") ?? ""
          : req.header("svix-id") ?? "",
        timestamp: standardHeaders
          ? req.header("webhook-timestamp") ?? ""
          : req.header("svix-timestamp") ?? "",
      });
    } catch (error) {
      if (error instanceof WebhookSignatureError) {
        res.status(401).send("Invalid signature");
        return;
      }
      throw error;
    }

    const event = JSON.parse(req.body.toString("utf8"));
    res.status(200).json({ received: event });
  },
);
```

`req.body` is a `Buffer` when `express.raw()` is used. `webhook-safe` does not ship an Express adapter.

### Next.js

Read the body once, as bytes, in the route handler.

```ts
import { verifyStandardWebhookSignature, WebhookSignatureError } from "webhook-safe";

export async function POST(request: Request) {
  const rawBody = Buffer.from(await request.arrayBuffer());
  const standardHeaders =
    request.headers.get("webhook-id") !== null ||
    request.headers.get("webhook-timestamp") !== null ||
    request.headers.get("webhook-signature") !== null;
  const signature = standardHeaders
    ? request.headers.get("webhook-signature") ?? ""
    : request.headers.get("svix-signature") ?? "";

  try {
    verifyStandardWebhookSignature(rawBody, signature, {
      secret: process.env.STANDARD_WEBHOOKS_SECRET!,
      id: standardHeaders
        ? request.headers.get("webhook-id") ?? ""
        : request.headers.get("svix-id") ?? "",
      timestamp: standardHeaders
        ? request.headers.get("webhook-timestamp") ?? ""
        : request.headers.get("svix-timestamp") ?? "",
    });
  } catch (error) {
    if (error instanceof WebhookSignatureError) {
      return new Response("Invalid signature", { status: 401 });
    }
    throw error;
  }

  const event = JSON.parse(rawBody.toString("utf8"));
  return Response.json({ received: event });
}
```

`request.text()` is the UTF-8 decoding of those bytes. It verifies when the signed body is that same Unicode string. Prefer `arrayBuffer()` when you need the original bytes.

### Options

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

- `secret` — `whsec_` plus standard base64, or the same base64 without the prefix
- `id` — `webhook-id` or `svix-id`
- `timestamp` — `webhook-timestamp` or `svix-timestamp`, Unix seconds
- `toleranceSeconds` — optional whole-second skew; defaults to 300
- `now` — optional current time in milliseconds, primarily for tests
- `previousSecrets` — optional previous secrets, at most two

The tolerance compares whole seconds: the absolute difference between `timestamp` and `Math.floor(now / 1000)` must be less than or equal to `toleranceSeconds`. The default matches the reference libraries' five-minute window. Timestamps that far in the past or the future are rejected. Message ids that contain `.` or whitespace are rejected.

### Error handling

A valid signature returns normally.

`WebhookSignatureError` means the signature, timestamp, id or header is unacceptable. That includes a missing header, a malformed `v1` value, a tampered body, the wrong secret, and an expired or future timestamp.

`Error` means the call is misconfigured: an empty secret, a secret that is not canonical base64, a non-finite or negative `toleranceSeconds` or `now`, or an invalid `previousSecrets` list. Those errors are thrown before the signature is treated as a simple mismatch.

```ts
import { WebhookSignatureError } from "webhook-safe";

try {
  verifyStandardWebhookSignature(rawBody, signatureHeader, options);
} catch (error) {
  if (error instanceof WebhookSignatureError) {
    // Reject the request.
  } else {
    // Fix the server configuration.
    throw error;
  }
}
```

### Secret format and rotation

The specification serializes symmetric secrets as standard base64 prefixed with `whsec_`. The prefix identifies the key. The HMAC key is the decoded bytes. The reference libraries also accept the base64 portion alone, and this verifier does too. Empty keys and non-canonical base64 are rejected. The specification recommends 24 to 64 decoded bytes. This function does not enforce that range.

The `webhook-signature` header can contain more than one space-separated signature so a sender can rotate keys without downtime. Verification accepts the header when any `v1` signature matches the current secret or a configured previous secret.

```ts
verifyStandardWebhookSignature(rawBody, signatureHeader, {
  secret: currentSecret,
  previousSecrets: [previousSecret],
  id: webhookId,
  timestamp: webhookTimestamp,
});
```

Remove `previousSecrets` after the overlap window. The library does not store secrets or rotate them at the sender. See [Signing-secret rotation](#signing-secret-rotation-080).

Use `webhook-id` with `handleWebhook`. The specification keeps that id the same when a delivery is retried.

## Paddle Billing

`webhook-safe` verifies [Paddle Billing](https://developer.paddle.com/webhooks/about/signature-verification) `Paddle-Signature` headers. There is no separate package to install, and the verifier does not use the Paddle SDK.

Paddle concatenates the `ts` value, a colon, and the raw request body, then computes HMAC-SHA256 with the notification destination secret key. The header contains `ts` and at least one `h1`. Paddle's documentation says that during secret rotation more than one `h1` is returned. The hex digest is lowercase in Paddle's examples and SDK comparison.

### Raw body

Do not parse or reformat the body before verification. Whitespace changes the digest.

```ts
import { verifyPaddleSignature } from "webhook-safe";

verifyPaddleSignature(rawBody, paddleSignatureHeader, {
  secret: process.env.PADDLE_WEBHOOK_SECRET!,
});
```

### Express

```ts
import express from "express";
import { verifyPaddleSignature, WebhookSignatureError } from "webhook-safe";

const app = express();

app.post(
  "/webhooks/paddle",
  express.raw({ type: "application/json" }),
  (req, res) => {
    try {
      verifyPaddleSignature(req.body, req.header("paddle-signature") ?? "", {
        secret: process.env.PADDLE_WEBHOOK_SECRET!,
      });
    } catch (error) {
      if (error instanceof WebhookSignatureError) {
        res.status(401).send("Invalid signature");
        return;
      }
      throw error;
    }

    const event = JSON.parse(req.body.toString("utf8")) as { event_id: string };
    res.status(200).json({ received: event.event_id });
  },
);
```

`express.raw()` keeps `req.body` as a `Buffer`. `webhook-safe` does not depend on Express.

### Next.js

```ts
import { verifyPaddleSignature, WebhookSignatureError } from "webhook-safe";

export async function POST(request: Request) {
  const rawBody = Buffer.from(await request.arrayBuffer());

  try {
    verifyPaddleSignature(rawBody, request.headers.get("paddle-signature") ?? "", {
      secret: process.env.PADDLE_WEBHOOK_SECRET!,
    });
  } catch (error) {
    if (error instanceof WebhookSignatureError) {
      return new Response("Invalid signature", { status: 401 });
    }
    throw error;
  }

  const event = JSON.parse(rawBody.toString("utf8")) as {
    event_id: string;
    event_type: string;
  };
  return Response.json({ received: event.event_id, type: event.event_type });
}
```

Paddle documents `event_id` as the id to use when a notification is delivered more than once. `notification_id` identifies the delivery attempt. Read both from the verified JSON, not from an unsigned header.

### Options

```ts
interface PaddleSignatureOptions {
  secret: string;
  toleranceSeconds?: number;
  now?: number;
  previousSecrets?: readonly string[];
}
```

- `secret` — notification destination secret key
- `toleranceSeconds` — optional absolute skew in seconds; defaults to 5
- `now` — optional current time in milliseconds, primarily for tests
- `previousSecrets` — optional previous secret keys, at most two

The default window matches Paddle's SDK: the absolute difference between `now` and `ts` in milliseconds must be less than or equal to five seconds. Older and future timestamps are rejected. Exactly five seconds of skew is accepted. A larger `toleranceSeconds` widens that window.

The header must contain one canonical Unix `ts` and one or more lowercase 64-character `h1` values, separated by semicolons. `ts=1671552777;h1=<hex>` is the documented shape. A second `h1` is accepted when one of them matches.

### Error handling

A valid signature returns normally. `WebhookSignatureError` covers a missing or malformed header, a tampered body, the wrong secret, and a timestamp outside the replay window. An empty secret, an invalid tolerance or clock, or an invalid `previousSecrets` list throws `Error`.

```ts
import { WebhookSignatureError } from "webhook-safe";

try {
  verifyPaddleSignature(rawBody, paddleSignatureHeader, {
    secret: process.env.PADDLE_WEBHOOK_SECRET!,
  });
} catch (error) {
  if (error instanceof WebhookSignatureError) {
    // Reject the request.
  } else {
    throw error;
  }
}
```

### Secret format and rotation

The endpoint secret key is an opaque string. Paddle's manual example uses that string directly as the HMAC key. This verifier does not base64-decode it.

Paddle documents multiple `h1` values while secrets are rotated. Each `h1` must be a 64-character lowercase hex digest, and any one that matches a configured secret is enough. `previousSecrets` also accepts a delivery signed only with a previous key you still hold:

```ts
verifyPaddleSignature(rawBody, paddleSignatureHeader, {
  secret: currentSecret,
  previousSecrets: [previousSecret],
});
```

Remove the previous key when the overlap ends. This package does not change the destination secret in Paddle.

## Lemon Squeezy

`webhook-safe` verifies [Lemon Squeezy](https://docs.lemonsqueezy.com/help/webhooks/signing-requests) `X-Signature` headers. There is no separate package to install.

Lemon Squeezy signs the raw body with HMAC-SHA256 and sends the lowercase hex digest in `X-Signature`. The documented Node example compares that hex string in constant time. There is no timestamp in the signature.

The request also includes `X-Event-Name`. That header is not part of the HMAC. After verification, read `meta.event_name` from the JSON body. The [webhook request](https://docs.lemonsqueezy.com/help/webhooks/webhook-requests) example includes `meta.event_name` and `data.id`.

### Raw body

Hash the bytes Lemon Squeezy sent. Do not re-serialize the JSON.

```ts
import { verifyLemonSqueezySignature } from "webhook-safe";

verifyLemonSqueezySignature(rawBody, requestSignature, {
  secret: process.env.LEMONSQUEEZY_WEBHOOK_SECRET!,
});
```

### Express

```ts
import express from "express";
import { verifyLemonSqueezySignature, WebhookSignatureError } from "webhook-safe";

const app = express();

app.post(
  "/webhooks/lemonsqueezy",
  express.raw({ type: "application/json" }),
  (req, res) => {
    try {
      verifyLemonSqueezySignature(req.body, req.header("x-signature") ?? "", {
        secret: process.env.LEMONSQUEEZY_WEBHOOK_SECRET!,
      });
    } catch (error) {
      if (error instanceof WebhookSignatureError) {
        res.status(401).send("Invalid signature");
        return;
      }
      throw error;
    }

    const event = JSON.parse(req.body.toString("utf8")) as {
      meta: { event_name: string };
      data: { id: string };
    };
    res.status(200).json({ received: event.data.id, type: event.meta.event_name });
  },
);
```

Lemon Squeezy retries a delivery that does not respond with HTTP 200. Acknowledge after the signature check, and make the work idempotent. `webhook-safe` does not depend on Express.

### Next.js

```ts
import { verifyLemonSqueezySignature, WebhookSignatureError } from "webhook-safe";

export async function POST(request: Request) {
  const rawBody = Buffer.from(await request.arrayBuffer());

  try {
    verifyLemonSqueezySignature(
      rawBody,
      request.headers.get("x-signature") ?? "",
      { secret: process.env.LEMONSQUEEZY_WEBHOOK_SECRET! },
    );
  } catch (error) {
    if (error instanceof WebhookSignatureError) {
      return new Response("Invalid signature", { status: 401 });
    }
    throw error;
  }

  const event = JSON.parse(rawBody.toString("utf8")) as {
    meta: { event_name: string };
    data: { id: string };
  };
  return Response.json({ received: event.data.id, type: event.meta.event_name });
}
```

`request.text()` matches `arrayBuffer()` for a UTF-8 JSON body. Use the buffer when you need the original bytes.

### Options

```ts
interface LemonSqueezySignatureOptions {
  secret: string;
  previousSecrets?: readonly string[];
}
```

- `secret` — signing secret configured on the webhook
- `previousSecrets` — optional previous signing secrets, at most two

There is no tolerance option. The provider signature does not include a timestamp.

### Error handling

A valid signature returns normally. `WebhookSignatureError` covers a missing header, a non-hex or wrong-length digest, a tampered body, and the wrong secret. The length is checked before `timingSafeEqual`, so a short header does not surface as `RangeError`. An empty secret or an invalid `previousSecrets` list throws `Error`.

```ts
import { WebhookSignatureError } from "webhook-safe";

try {
  verifyLemonSqueezySignature(rawBody, signatureHeader, {
    secret: process.env.LEMONSQUEEZY_WEBHOOK_SECRET!,
  });
} catch (error) {
  if (error instanceof WebhookSignatureError) {
    // Reject the request.
  } else {
    throw error;
  }
}
```

### Secret format and rotation

Lemon Squeezy asks you to choose the signing secret when you create the webhook. The docs describe it as any string you want, normally 6 to 40 characters. This function requires a nonempty string and does not enforce that usual length. The secret is the HMAC key as stored. It is not base64-decoded.

The provider docs show one `X-Signature` value, not a list. When you change the secret on an existing webhook, pass the previous value in `previousSecrets` until deliveries signed with it have stopped, then remove it:

```ts
verifyLemonSqueezySignature(rawBody, signatureHeader, {
  secret: currentSecret,
  previousSecrets: [previousSecret],
});
```

The library does not update the secret in Lemon Squeezy.

## Signing-secret rotation (0.8.0+)

Signing-secret rotation is available in **0.8.0 and later**. Install a compatible
version before using these options.

Keep `secret` as the current signing key and provide up to two older keys in
`previousSecrets` while your provider's deliveries transition:

```ts
const event = parseStripeWebhook(rawBody, stripeSignatureHeader, {
  secret: currentSecret,
  previousSecrets: [previousSecret],
});
```

Stripe, GitHub, Shopify and Slack verification and parsing helpers have accepted
this option since 0.8.0. The 0.10.0 Standard Webhooks, Paddle Billing and
Lemon Squeezy verifiers accept it too. Generic HMAC takes it as an optional
fourth argument:

```ts
verifyHmacSignature(rawBody, signatureHeader, currentSecret, {
  previousSecrets: [previousSecret],
});
```

Existing calls with one secret retain their behavior. An omitted or empty list
uses only the current secret. Lists must contain at most two distinct nonempty
strings, different from the current secret; when rotation is configured, the
current secret must also be nonempty. Invalid configuration throws a fixed error
without including key values. All configured keys are evaluated, and verification
returns the usual success/failure result without identifying the matching key.
This is not a general constant-time execution guarantee.

**You control the overlap window.** Keep it short and deliberate: load the new key
and the previous key, follow your provider's supported rotation procedure, then
remove the previous key once the intended transition has finished. Removing it
stops accepting signatures made with it. The library does not change provider
settings, store secrets, schedule expiration or decide an appropriate retention
period. Never commit actual keys, log them or send them to a browser.

Stripe, Slack, Standard Webhooks and Paddle timestamp tolerances still apply to
every key; adding old keys does not permit stale deliveries. Lemon Squeezy
signatures have no timestamp, so rotation does not add replay protection there.
All other provider signature-format and raw-byte checks remain in force. Use the
same signed event or delivery identity for deduplication across both keys, rather
than a signature or the key that accepted it.

See [the processing example](examples/secret-rotation.ts). Webhook Safe Cloud's
secret-management controls are separate; this library feature does not activate
rotation in the hosted service.

## Processing leases

Each processing claim has a lease.

The default lease is **5 minutes**.

```ts
const result = await handleWebhook(event, {
  store,
  getKey: (event) => event.id,
  leaseMs: 5 * 60 * 1000,
  handler: async (event) => {
    // Process the webhook
  },
});
```

If a worker claims an event but never completes or releases it, the processing claim eventually expires and the event can be attempted again.

While the handler is running, `webhook-safe` automatically renews the processing lease. This prevents long-running handlers from losing their claim simply because the original lease duration elapsed.

Lease renewal is ownership-safe: a worker can renew only the claim it currently owns. If renewal fails or the worker no longer owns the claim, `handleWebhook` rejects instead of reporting the event as successfully processed.

Choose a lease duration that gives your store enough time to renew the claim reliably during normal operation.

Immediate synchronous throws and rejected handler promises both release the
claim. An in-flight renewal settles before completion or release, so a lost lease
cannot be hidden by a handler finishing at the same time. If processing and
release both fail, an `AggregateError` contains both failures and retains the
processing failure as `cause`. A failed release can leave the claim held until
expiry. Store operations need bounded timeouts supplied by your application.

Lease loss rejects processing but cannot cancel application work that is already
running. A late handler never marks the event completed through this invocation;
external side effects still need application-level idempotency. This library does
not promise exactly-once effects or provide a durable queue.


## Retry behavior

If your handler throws an error, `webhook-safe` releases the event so a later delivery can retry it.

```ts
await handleWebhook(event, {
  store,
  getKey: (event) => event.id,
  handler: async (event) => {
    await processPayment(event);
  },
});
```

If `processPayment` throws, the claim is released.

A later delivery can claim the event again and retry the work.

Processing claims also expire automatically if a worker disappears without completing or releasing them.

## Stores

### MemoryStore

`MemoryStore` is useful for:

- local development
- tests
- examples
- single-process applications

```ts
import { MemoryStore } from "webhook-safe";

const store = new MemoryStore();
```

Completed events remain in memory for the lifetime of the store instance.

For production systems with multiple application instances, use a shared store such as Redis or PostgreSQL.

### RedisStore

`RedisStore` provides shared idempotency state across multiple application instances.

Install the Redis client:

```bash
npm install redis
```

Then create the store:

```ts
import { createClient } from "redis";
import { RedisStore } from "webhook-safe";

const client = createClient({
  url: process.env.REDIS_URL,
});

await client.connect();

const store = new RedisStore(client);
```

You can then use it with `handleWebhook`:

```ts
const result = await handleWebhook(event, {
  store,
  getKey: (event) => event.id,
  handler: async (event) => {
    await processWebhook(event);
  },
});
```

Processing claims use Redis expiration so abandoned work can eventually be retried.

Completed events are retained for **24 hours by default**.

You can configure the completed-event retention period:

```ts
const store = new RedisStore(client, "webhook-safe:", 7 * 24 * 60 * 60 * 1000);
```

The example above keeps completed event IDs for 7 days.

`RedisStore` uses atomic Redis operations and ownership-checked Lua scripts for claiming, renewing, releasing, and completing webhook processing.

The Redis implementation is also exercised against a real Redis service in CI.

### PostgresStore

`PostgresStore` provides shared idempotency state using PostgreSQL.

Install the PostgreSQL client:

```bash
npm install pg
```

Create a PostgreSQL pool and initialize the `webhook-safe` table:

```ts
import { Pool } from "pg";
import { POSTGRES_STORE_SCHEMA, PostgresStore } from "webhook-safe";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

await pool.query(POSTGRES_STORE_SCHEMA);

const store = new PostgresStore(pool);
```

`POSTGRES_STORE_SCHEMA` creates the required table if it does not already exist:

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

You can then use the store with `handleWebhook` exactly like the other stores:

```ts
const result = await handleWebhook(event, {
  store,
  getKey: (event) => event.id,
  handler: async (event) => {
    await processWebhook(event);
  },
});
```

Processing claims expire automatically, allowing abandoned work to be reclaimed.

Completed events are retained for **24 hours by default**.

You can configure the completed-event retention period:

```ts
const store = new PostgresStore(pool, 7 * 24 * 60 * 60 * 1000);
```

The example above keeps completed event IDs for 7 days.

`PostgresStore` uses atomic PostgreSQL `INSERT ... ON CONFLICT` and ownership-checked `UPDATE` and `DELETE` operations for claiming, renewing, releasing, and completing webhook processing.

Expired rows do not need to be removed before their event key can be claimed again. Applications may still periodically remove expired rows if they want to reclaim database storage.

The PostgreSQL implementation is exercised against a real PostgreSQL service in CI.

## Production considerations

For production webhook processing:

- use a shared store such as `RedisStore` or `PostgresStore`
- use a stable provider event or delivery ID as the idempotency key
- verify webhook signatures before processing
- preserve the exact raw request body when signature verification requires it
- choose an appropriate processing lease
- choose an appropriate completed-event retention period
- make downstream side effects idempotent where possible

For Stripe, use the Stripe event `id` as the idempotency key and preserve the raw request payload used to generate the signature.

For GitHub, use the `X-GitHub-Delivery` value as the idempotency key and preserve the raw request payload used to generate the signature.

For Shopify, use the Shopify webhook ID as the idempotency key and preserve the raw request payload used to generate the signature.

For Standard Webhooks, use the `webhook-id` value as the idempotency key. The specification keeps that id stable across retries. Preserve the raw body covered by `webhook-signature`.

For Paddle Billing, use the verified payload's `event_id` as the idempotency key. Paddle documents `event_id` as the event identity and `notification_id` as the delivery attempt. Preserve the raw body covered by `Paddle-Signature`.

For Lemon Squeezy, derive the idempotency key from the verified JSON body. The documented order payload includes `meta.event_name` and `data.id`. `X-Event-Name` is not part of the HMAC.

`webhook-safe` protects ownership of the webhook-processing claim and automatically renews that claim while your handler is running.

Your application should still make important downstream side effects idempotent where possible. Distributed systems can fail at boundaries outside the idempotency store, such as after an external API call succeeds but before the webhook event is marked completed.

## API

### `handleWebhook(event, options)`

Safely processes an event using an idempotency store.

```ts
const result = await handleWebhook(event, {
  store,
  getKey: (event) => event.id,
  handler: async (event) => {
    // Process event
  },
  leaseMs: 5 * 60 * 1000,
});
```

Options:

- `store` — idempotency store
- `getKey` — returns the unique idempotency key for the event
- `handler` — processes the event
- `leaseMs` — optional processing lease duration

Returns:

```ts
Promise<"processed" | "duplicate">;
```

### `MemoryStore`

In-memory implementation of the idempotency store.

```ts
const store = new MemoryStore();
```

### `RedisStore`

Redis-backed implementation of the idempotency store.

```ts
const store = new RedisStore(client);
```

Optional constructor arguments:

```ts
const store = new RedisStore(client, "webhook-safe:", 24 * 60 * 60 * 1000);
```

Arguments:

1. Redis client
2. key prefix
3. completed-event retention in milliseconds

### `PostgresStore`

PostgreSQL-backed implementation of the idempotency store.

```ts
const store = new PostgresStore(pool);
```

Optional completed-event retention:

```ts
const store = new PostgresStore(pool, 24 * 60 * 60 * 1000);
```

Arguments:

1. PostgreSQL client or pool
2. completed-event retention in milliseconds

Initialize the required table with:

```ts
await pool.query(POSTGRES_STORE_SCHEMA);
```

`POSTGRES_STORE_SCHEMA` is exported from `webhook-safe`.

### `verifyHmacSignature(payload, signature, secret)`

Verifies an HMAC-SHA256 webhook signature.

```ts
verifyHmacSignature(rawBody, signature, process.env.WEBHOOK_SECRET!);
```

Both of these signature formats are accepted:

```text
0123456789abcdef...
```

```text
sha256=0123456789abcdef...
```

An invalid signature throws `WebhookSignatureError`.

### `verifyStripeSignature(payload, signatureHeader, options)`

Verifies a Stripe `Stripe-Signature` header.

```ts
const valid = verifyStripeSignature(rawBody, signatureHeader, {
  secret: process.env.STRIPE_WEBHOOK_SECRET!,
});
```

Options:

- `secret` — Stripe webhook signing secret
- `toleranceSeconds` — optional timestamp tolerance; defaults to 300 seconds
- `now` — optional current time in milliseconds, primarily useful for deterministic testing

Returns:

```ts
boolean;
```

### `parseStripeWebhook(payload, signatureHeader, options)`

Verifies, parses, and validates a Stripe webhook event.

```ts
const event = parseStripeWebhook(rawBody, signatureHeader, {
  secret: process.env.STRIPE_WEBHOOK_SECRET!,
});
```

Returns a `StripeWebhookEvent<T>`.

It throws if:

- the Stripe signature is invalid
- the payload is not valid JSON
- the payload does not contain the minimum Stripe event envelope

### `verifyGitHubSignature(payload, signatureHeader, options)`

Verifies a GitHub `X-Hub-Signature-256` header.

```ts
verifyGitHubSignature(rawBody, signatureHeader, {
  secret: process.env.GITHUB_WEBHOOK_SECRET!,
});
```

Options:

- `secret` — GitHub webhook secret

The signature must use the `sha256=<hex>` format.

A valid signature returns normally. An invalid signature throws.

### `parseGitHubWebhook(payload, signatureHeader, options)`

Verifies and parses a GitHub webhook delivery.

```ts
const event = parseGitHubWebhook(rawBody, signatureHeader, {
  secret: process.env.GITHUB_WEBHOOK_SECRET!,
  event: githubEventHeader,
  deliveryId: githubDeliveryHeader,
});
```

Options:

- `secret` — GitHub webhook secret
- `event` — value of the `X-GitHub-Event` header
- `deliveryId` — value of the `X-GitHub-Delivery` header

Returns a `GitHubWebhookEvent<T>`:

```ts
interface GitHubWebhookEvent<T = unknown> {
  deliveryId: string;
  event: string;
  payload: T;
}
```

It throws if:

- the GitHub signature is invalid
- the event header is missing
- the delivery ID is missing
- the payload is not valid JSON
- the parsed payload is not a JSON object

### `verifyShopifySignature(payload, signatureHeader, options)`

Verifies a Shopify webhook HMAC signature.

```ts
verifyShopifySignature(rawBody, shopifyHmacHeader, {
  secret: process.env.SHOPIFY_WEBHOOK_SECRET!,
});
```

Options:

- `secret` — Shopify webhook secret

A valid signature returns normally. An invalid signature throws `WebhookSignatureError`.

### `parseShopifyWebhook(payload, signatureHeader, options)`

Verifies and parses a Shopify webhook delivery.

```ts
const event = parseShopifyWebhook(rawBody, shopifyHmacHeader, {
  secret: process.env.SHOPIFY_WEBHOOK_SECRET!,
  topic: shopifyTopicHeader,
  webhookId: shopifyWebhookIdHeader,
});
```

Options:

- `secret` — Shopify webhook secret
- `topic` — Shopify webhook topic
- `webhookId` — Shopify webhook delivery ID

Returns a `ShopifyWebhookEvent<T>`:

```ts
interface ShopifyWebhookEvent<T = unknown> {
  webhookId: string;
  topic: string;
  payload: T;
}
```

It throws if:

- the Shopify signature is invalid
- the topic is missing
- the webhook ID is missing
- the payload is not valid JSON
- the parsed payload is not a JSON object

### `verifySlackSignature(payload, signatureHeader, options)`

Verifies a Slack v0 signature over the original request bytes. Returns normally
on success and throws `WebhookSignatureError` for invalid signatures or timestamps.

Options:

- `secret` — Slack app Signing Secret
- `timestamp` — value of `X-Slack-Request-Timestamp`
- `toleranceSeconds` — optional 0–300-second window; defaults to 300
- `now` — optional current time in milliseconds, primarily for tests

### `parseSlackWebhook(payload, signatureHeader, options)`

Verifies and parses Slack Events API JSON using the same signature options.
Returns `SlackWebhookEvent<T>`: a URL-verification challenge or an event callback.
Throws for invalid signatures, malformed JSON or unsupported/invalid envelopes.
See [Slack event parsing](#slack-event-parsing) for the result shape.

### `verifyStandardWebhookSignature(payload, signatureHeader, options)`

Verifies a Standard Webhooks v1 signature, including the same values from Svix's
`svix-signature` header. Returns void. Throws `WebhookSignatureError` when the
signature, id, timestamp or header is invalid.

```ts
verifyStandardWebhookSignature(rawBody, signatureHeader, {
  secret: process.env.STANDARD_WEBHOOKS_SECRET!,
  id: webhookId,
  timestamp: webhookTimestamp,
});
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

`secret` is `whsec_` base64 or the unprefixed base64 key. `id` and `timestamp`
are the message id and Unix seconds. `toleranceSeconds` defaults to 300 whole
seconds in either direction. `now` is milliseconds. `previousSecrets` accepts up
to two earlier secrets. See [Standard Webhooks](#standard-webhooks).

### `verifyPaddleSignature(payload, signatureHeader, options)`

Verifies a Paddle Billing `Paddle-Signature` header. Returns void. Throws
`WebhookSignatureError` when the signature, timestamp or header is invalid.

```ts
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

`secret` is the notification destination secret key string. `toleranceSeconds`
defaults to 5. `now` is milliseconds. `previousSecrets` accepts up to two earlier
keys. Multiple `h1` values are accepted when one matches. See
[Paddle Billing](#paddle-billing).

### `verifyLemonSqueezySignature(payload, signatureHeader, options)`

Verifies a Lemon Squeezy `X-Signature` lowercase hex HMAC-SHA256 digest of the
raw body. Returns void. Throws `WebhookSignatureError` when the signature is
missing or does not match.

```ts
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

`secret` is the webhook signing secret. `previousSecrets` accepts up to two
earlier secrets. There is no timestamp argument. See
[Lemon Squeezy](#lemon-squeezy).

### `isWebhookEvent(value)`

Runtime validation helper for the generic webhook event shape.

```ts
if (!isWebhookEvent(value)) {
  throw new Error("Invalid webhook event");
}
```

The expected shape is:

```ts
interface WebhookEvent {
  id: string;
  type: string;
  payload: unknown;
}
```

### Completion acknowledgement (0.8.1+)

Since 0.8.1, MemoryStore, RedisStore and PostgresStore reject
`setCompleted` with `WebhookError` when the processing claim is missing, expired,
already completed or owned by another worker. `handleWebhook` propagates that
failure instead of returning `"processed"`. Cleanup checks ownership and cannot
release a replacement worker's claim. Store/network errors also propagate; a
failed write can have an uncertain outcome.

Your business handler may already have performed its side effects when completion
fails. This error does not roll those effects back and must not be converted into
a success response blindly. Use idempotent downstream operations or a transaction
that coordinates your business write with its event identity. Review the result
before manually replaying or retrying a non-idempotent operation.

This behavior requires 0.8.1 or later; it is not part of 0.8.0.

## Custom stores

You can implement your own persistence backend using the `IdempotencyStore` interface.

```ts
import type {
  EventStatus,
  IdempotencyClaim,
  IdempotencyStore,
} from "webhook-safe";

class CustomStore implements IdempotencyStore {
  async get(key: string): Promise<EventStatus | null> {
    // Read the current state.
    return null;
  }

  async claim(key: string, leaseMs: number): Promise<IdempotencyClaim | null> {
    // Atomically claim the event.
    return null;
  }

  async renew(
    key: string,
    claim: IdempotencyClaim,
    leaseMs: number,
  ): Promise<boolean> {
    // Renew only if this claim still owns the event.
    return false;
  }

  async release(key: string, claim: IdempotencyClaim): Promise<void> {
    // Release only if this claim still owns the event.
  }

  async setCompleted(key: string, claim: IdempotencyClaim): Promise<void> {
    // Atomically complete only an active claim owned by this token.
    // Throw if no completion was recorded; do not silently return.
  }
}
```

Custom stores should implement `claim`, `renew`, `release`, and `setCompleted` using atomic ownership checks where supported by the underlying datastore.
`setCompleted` keeps its `Promise<void>` signature: resolve only after recording
completion for an unexpired owned claim, and reject on an ownership/expiry miss
or store error. `handleWebhook` relies on this acknowledgement; it cannot detect
a custom store that silently skips a completion write.

## Security

Webhook signatures should be verified before processing an event.

`verifyHmacSignature`:

- computes an HMAC-SHA256 digest
- accepts raw hexadecimal signatures
- accepts signatures prefixed with `sha256=`
- compares signatures using a timing-safe comparison
- throws `WebhookSignatureError` when verification fails

`verifyStripeSignature`:

- verifies Stripe's timestamped HMAC-SHA256 signature format
- supports multiple `v1` signatures
- compares signatures using a timing-safe comparison
- rejects signatures outside the configured timestamp tolerance

`parseStripeWebhook` verifies the Stripe signature before parsing the event.

`verifyGitHubSignature`:

- verifies GitHub's `sha256=<hex>` HMAC-SHA256 signature format
- uses timing-safe signature comparison through the generic HMAC verifier
- rejects missing or incorrect signature prefixes
- throws when verification fails

`parseGitHubWebhook` verifies the GitHub signature before parsing the payload.

`verifyShopifySignature`:

- computes an HMAC-SHA256 digest over the raw webhook payload
- verifies Shopify's Base64-encoded signature format
- compares signatures using a timing-safe comparison
- throws `WebhookSignatureError` when verification fails

`parseShopifyWebhook` verifies the Shopify signature before parsing the payload.

`verifySlackSignature` checks Slack v0 signatures with a maximum five-minute timestamp window. `parseSlackWebhook` verifies before parsing Events API JSON; challenge responses do not enter the business-event queue.

`verifyStandardWebhookSignature`:

- verifies Standard Webhooks v1 HMAC-SHA256 over `id.timestamp.` plus the raw body
- decodes `whsec_` base64 secrets before signing
- accepts every space-separated `v1` signature, which is how senders rotate keys
- compares the 32-byte digest with `timingSafeEqual` after a length check
- rejects ids that contain `.`, malformed headers, and timestamps outside the whole-second tolerance
- does not verify `v2a` asymmetric signatures

`verifyPaddleSignature`:

- verifies HMAC-SHA256 of `ts:` plus the raw body
- accepts one or more lowercase `h1` digests in `Paddle-Signature`
- compares hex digests with `timingSafeEqual` after a length check
- rejects timestamps more than the configured skew away from `now` in either direction
- uses the endpoint secret string as the HMAC key

`verifyLemonSqueezySignature`:

- verifies the lowercase hex HMAC-SHA256 of the raw body in `X-Signature`
- compares the hex string with `timingSafeEqual` after a length check
- rejects missing, short, non-hex and uppercase signatures
- does not apply a timestamp window, because the provider signature has none

Always use the exact raw request payload expected by your webhook provider when verifying signatures.
All signature helpers accept a `string` or `Buffer`; pass the original `Buffer`
when receiving HTTP bytes. Decoding bytes and encoding them again can change
signed content. Parsing helpers verify signatures before decoding/parsing JSON;
provider-specific payload validation remains your application's responsibility.

Stripe timestamps must be unambiguous non-negative decimal integers; duplicate
`t` fields, fractional/exponent/signed forms and malformed digest lengths are
rejected. `now` must be finite and non-negative, and the signing secret must not
be empty. Multiple `v1` candidates remain supported. Shopify expects canonical
Base64 for its 32-byte SHA-256 digest, including the final `=` padding.

Standard Webhooks timestamps use the same unambiguous decimal form. The tolerance
is applied to whole seconds and defaults to 300. Paddle's `ts` uses that form
too; its default tolerance is five seconds, measured in milliseconds, in both
directions. Secrets for those schemes must be nonempty. A Standard Webhooks
secret must also be canonical base64, with or without the `whsec_` prefix.
Lemon Squeezy compares a 64-character lowercase hex digest and has no timestamp.


## Library or hosted service?

Use this package when you want to run verification and idempotency in your own
application. It does not create an endpoint, queue or hosted delivery worker.
For managed ingestion, forwarding, retries and event inspection, see the separate
[Webhook Safe Cloud documentation](https://www.webhook-safe.com/docs).

## Roadmap

Potential future additions include:

- replay tooling
- framework integrations
- operational dashboard

## License

MIT


## Cloud delivery verification (0.9.0 release preparation)

`verifyCloudSignature` is prepared for 0.9.0; it is not exported by published
0.8.1. Cloud delivery signing also requires its separate approved rollout and
per-endpoint setup. Do not assume current hosted deliveries have these headers.

After rollout, configure a separate random delivery signing key of at least 32
bytes in your receiver and Cloud endpoint. Never reuse the provider signing key.
The helper throws `WebhookSignatureError` for invalid signatures, timestamps or
identities and returns void on success. Configuration errors throw Error.

```ts
import { verifyCloudSignature } from "webhook-safe";

verifyCloudSignature(rawBody, signatureHeader, {
  secret: deliverySigningSecret,
  deliveryId: webhookSafeId,
  timestamp: webhookSafeTimestamp,
  // previousSecrets: [previousDeliverySigningSecret],
});
// Parse and validate your event only after successful verification.
```

Your HTTP adapter must bound the raw body and header sizes, require one
`webhook-safe-id` and `webhook-safe-timestamp` value, and pass the combined
`webhook-safe-signature` value unchanged. Preserve original Buffer bytes before
JSON middleware. Duplicate identity/timestamp headers are rejected when joined;
Cloud uses one signature header with up to two v1 candidates during overlap.
The verifier bounds the signature header to at most three candidates and 206
characters for compatibility with up to two configured previous verifier keys.

The signed message is UTF-8 `v1\n{timestamp}\n{deliveryId}\n` followed by the
original body bytes. HMAC-SHA256 lower-case hex candidates use `v1=<digest>`,
comma separated. Identity is the canonical lower-case Cloud event UUID. The
canonical Unix timestamp is in seconds. It is regenerated for each attempt;
identity is retained across retries and manual replay. Content-Type, URL and
other headers are not authenticated by this signature.

The default tolerance is 300 seconds in either direction. `toleranceSeconds`
may reduce it to 0–300; `now` is a finite non-negative clock in milliseconds,
primarily for tests. Keep receiver clocks synchronized. Verification does not
make a delivery new: deduplicate by the verified identity using a durable shared
store and make downstream side effects idempotent. Normal replay retains the
identity and will therefore remain a duplicate in your receiver unless you
explicitly arrange safe business recovery. See the tested [receiver example](examples/cloud.ts).

For key rotation, deploy receiver acceptance of the next key first. Cloud can
sign with current and previous keys for up to 24 hours, then stops using the
old key. Remove previous verifier keys after overlap and the timestamp/in-flight
window have passed. Immediate revocation cannot retract signed requests already
in flight. Secrets are accepted from application configuration, never stored,
generated or automatically expired by this library.
