# webhook-safe

Safe, idempotent webhook handling for Node.js and TypeScript.

## Why?

Webhook providers can deliver the same event more than once.

`webhook-safe` makes it easy to ensure your handler processes each event only once while allowing failed or abandoned processing to be retried.

## Installation

```bash
npm install webhook-safe
```

## Basic usage

```ts
import { handleWebhook, MemoryStore, verifyHmacSignature } from "webhook-safe";

const store = new MemoryStore();

const payload = JSON.stringify({
  id: "event_123",
  type: "payment.created",
  payload: {
    amount: 1000,
  },
});

const signature = "your-hmac-signature";
const secret = "your-webhook-secret";

// Throws WebhookSignatureError if the signature is invalid.
verifyHmacSignature(payload, signature, secret);

const event = JSON.parse(payload);

const result = await handleWebhook(event, {
  store,
  getKey: (event) => event.id,
  handler: async (event) => {
    console.log("Processing event:", event);
  },
});

console.log(result);
// "processed" or "duplicate"
```

### What happens?

For a new event:

```text
request
  ↓
verify signature
  ↓
claim event
  ↓
run handler
  ↓
mark completed
```

For a duplicate event:

```text
request
  ↓
verify signature
  ↓
claim event
  ↓
duplicate
```

If the handler fails:

```text
request
  ↓
claim event
  ↓
run handler
  ↓
handler fails
  ↓
release event
  ↓
provider can retry
```

If the application crashes while processing:

```text
request
  ↓
claim event
  ↓
run handler
  ↓
application crashes
  ↓
processing lease expires
  ↓
provider retries
  ↓
event can be claimed again
```

## Behavior

A new event is processed normally:

```text
event → claim → handler → completed
```

A duplicate event is ignored:

```text
event → claim → duplicate
```

If the handler fails, the event is released so a later delivery can retry it:

```text
event → claim → handler fails → release → retry
```

If the application crashes while processing an event, the processing lease eventually expires:

```text
event → claim → application crashes → lease expires → retry
```

## Current features

- Atomic in-memory idempotency
- Redis-backed idempotency
- Duplicate event protection
- Processing leases
- Retry after handler failure
- Retry after abandoned processing
- Generic HMAC-SHA256 signature verification
- Timing-safe signature comparison
- TypeScript support
- Framework agnostic
- Custom idempotency store support
- Ownership-aware processing claims

## API

### `handleWebhook()`

Processes a webhook event while preventing duplicate processing.

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

Returns:

```text
"processed"
```

for a newly processed event, or:

```text
"duplicate"
```

when another delivery has already claimed or completed the event.

#### Processing lease

Each claimed event receives a processing lease.

By default, the lease is **5 minutes**:

```ts
leaseMs: 5 * 60 * 1000;
```

If the handler completes successfully, the event is marked as completed and will not be processed again.

If the handler fails, the event is released immediately so a later delivery can retry it.

If the application crashes while the handler is running, the processing lease eventually expires and a later delivery can claim the event again.

You can configure the lease for longer-running handlers:

```ts
const result = await handleWebhook(event, {
  store,
  leaseMs: 10 * 60 * 1000,
  getKey: (event) => event.id,
  handler: async (event) => {
    // Process the webhook
  },
});
```

Choose a lease long enough for your handler to normally complete, but short enough that abandoned events can eventually be retried.

### `MemoryStore`

An in-memory idempotency store suitable for development, testing, and single-process applications.

```ts
const store = new MemoryStore();
```

For production systems running multiple processes or servers, use `RedisStore` or implement `IdempotencyStore` using shared storage.

`MemoryStore` also respects processing leases. An abandoned `"processing"` event becomes claimable after its lease expires.

### `RedisStore`

A Redis-backed idempotency store for production applications running multiple processes or servers.

Redis is an optional peer dependency.

Install the Redis client:

```bash
npm install redis
```

Create a Redis client:

```ts
import { createClient } from "redis";
import { handleWebhook, RedisStore } from "webhook-safe";

const client = createClient({
  url: process.env.REDIS_URL,
});

await client.connect();

const store = new RedisStore(client);

const result = await handleWebhook(event, {
  store,
  getKey: (event) => event.id,
  handler: async (event) => {
    // Process the webhook
  },
});

console.log(result);
```

`RedisStore` uses Redis's atomic `SET NX` operation when claiming an event, together with a processing lease.

Each processing claim receives a unique ownership token.

Releasing or completing an event is performed atomically and only succeeds when the supplied claim still owns the event.

The lease is stored using Redis key expiration, so an abandoned processing claim eventually becomes available for a later delivery.

When your application shuts down, close the Redis connection:

```ts
await client.quit();
```

### `verifyHmacSignature()`

Verifies an HMAC-SHA256 signature.

```ts
verifyHmacSignature(payload, signature, secret);
```

The function returns normally when the signature is valid.

It throws `WebhookSignatureError` when the signature is invalid.

### `WebhookSignatureError`

Thrown when webhook signature verification fails.

```ts
import { WebhookSignatureError } from "webhook-safe";
```

### `WebhookEvent`

The generic webhook event type:

```ts
interface WebhookEvent {
  id: string;
  type: string;
  payload: unknown;
}
```

### `IdempotencyClaim`

Represents ownership of an active processing claim.

```ts
interface IdempotencyClaim {
  token: string;
}
```

The token uniquely identifies the worker that currently owns the processing claim.

Claims are returned by `claim()` and must be passed to `release()` or `setCompleted()`.

### `IdempotencyStore`

The interface used by `handleWebhook()` to track event processing.

```ts
interface IdempotencyStore {
  get(key: string): Promise<EventStatus | null>;

  claim(key: string, leaseMs: number): Promise<IdempotencyClaim | null>;

  release(key: string, claim: IdempotencyClaim): Promise<void>;

  setCompleted(key: string, claim: IdempotencyClaim): Promise<void>;
}
```

This makes it possible to replace the built-in stores with another persistent implementation.

Each processing claim has a unique ownership token.

Stores must ensure that `release()` and `setCompleted()` only affect the event when the supplied claim still owns the active processing lease.

When implementing a custom store, `claim()` must atomically prevent multiple workers from claiming the same active event.

A processing claim should become available again after `leaseMs` if it has not been completed or explicitly released.

## Important production note

`MemoryStore` stores state only in the current Node.js process.

If your application runs multiple instances, containers, serverless functions, or multiple workers, use `RedisStore` or another shared persistent implementation of `IdempotencyStore`.

For production workloads, configure the processing lease based on the expected maximum duration of your webhook handler.

A processing claim belongs to the worker that successfully claimed it. If the claim expires and another worker successfully claims the same event, the old worker can no longer release or complete the newer claim.

## Framework support

`webhook-safe` is framework agnostic.

It can be used with:

- Express
- Fastify
- Next.js
- Hono
- Node.js HTTP servers
- Other Node.js frameworks

## Roadmap

- [ ] PostgreSQL store
- [ ] Stripe webhook helper
- [ ] GitHub webhook helper
- [ ] Replay protection
- [ ] Framework integrations
- [ ] Webhook event inspection and replay service

## License

MIT
