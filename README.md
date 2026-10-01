# webhook-safe

The easiest inbound webhook idempotency middleware for TypeScript.

`webhook-safe` helps you safely process inbound webhooks without accidentally processing the same event multiple times.

## Features

- Redis-backed idempotency
- Duplicate event protection
- Atomic event claiming
- Automatically renewed processing leases
- Retry after handler failure
- Retry after abandoned processing
- Ownership-safe completion and release
- Generic HMAC-SHA256 signature verification
- Supports raw hexadecimal and `sha256=<hex>` signatures
- Timing-safe signature comparison
- Runtime webhook event validation
- TypeScript support
- Framework agnostic
- Custom idempotency store support
- In-memory `MemoryStore`
- Redis-backed `RedisStore`
- Configurable Redis completed-event retention

## Installation

```bash
npm install webhook-safe
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

For production systems with multiple application instances, use a shared store such as Redis.

### RedisStore

`RedisStore` provides shared idempotency state across multiple application instances.

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

## Production considerations

For production webhook processing:

- use a shared store such as `RedisStore`
- use a stable provider event ID as the idempotency key
- verify webhook signatures before processing
- preserve the raw request body when signature verification requires it
- choose an appropriate processing lease
- choose an appropriate completed-event retention period
- make downstream side effects idempotent where possible

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

Always use the raw request payload expected by your webhook provider when verifying signatures.

## Roadmap

Potential future additions include:

- PostgreSQL store
- Stripe webhook helpers
- GitHub webhook helpers
- Shopify webhook helpers
- replay protection
- framework integrations
- operational dashboard

## License

MIT
