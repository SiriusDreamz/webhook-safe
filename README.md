# webhook-safe

The easiest inbound webhook idempotency middleware for TypeScript.

`webhook-safe` helps you safely process inbound webhooks without accidentally processing the same event multiple times.

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
    // Complete only if this claim still owns the event.
  }
}
```

Custom stores should implement `claim`, `renew`, `release`, and `setCompleted` using atomic ownership checks where supported by the underlying datastore.

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

Always use the exact raw request payload expected by your webhook provider when verifying signatures.

## Roadmap

Potential future additions include:

- replay tooling
- framework integrations
- operational dashboard

## License

MIT
