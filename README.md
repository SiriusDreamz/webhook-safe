# webhook-safe

The easiest inbound webhook idempotency middleware for TypeScript.

`webhook-safe` helps you safely process inbound webhooks exactly once from your application's perspective, while handling duplicate deliveries, concurrent requests, handler failures, and abandoned processing.

## Features

- Redis-backed idempotency
- Duplicate event protection
- Atomic event claiming
- Processing leases
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

const payload = JSON.stringify({
  id: "evt_123",
  type: "payment.completed",
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

A lease is not a heartbeat. If a handler runs longer than the configured lease, another worker may be able to claim the event after the lease expires.

Choose a lease duration appropriate for the maximum expected processing time of your handler.

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

If `processPayment()` throws, the event is not marked completed.

A later delivery can therefore claim and process the event again.

## MemoryStore

`MemoryStore` is useful for development, tests, and applications where in-process state is sufficient.

```ts
import { MemoryStore } from "webhook-safe";

const store = new MemoryStore();
```

The store is local to the current process.

Completed events remain in the `MemoryStore` for the lifetime of that `MemoryStore` instance.

For production applications with multiple processes or instances, use a shared store such as Redis.

## RedisStore

`RedisStore` provides shared idempotency state using Redis.

The Redis client is an optional peer dependency:

```bash
npm install redis
```

Example:

```ts
import { createClient } from "redis";
import { RedisStore } from "webhook-safe";

const client = createClient({
  url: process.env.REDIS_URL,
});

await client.connect();

const store = new RedisStore(client);
```

`RedisStore` uses an atomic Redis `SET NX PX` operation to claim events.

Each processing claim receives a unique ownership token.

Completion and release verify that the caller still owns the claim before changing the event state.

This prevents an expired worker from completing or releasing a newer worker's claim.

### Redis completed-event retention

Completed events are retained for **24 hours by default**.

You can configure the retention period with the third constructor argument:

```ts
const store = new RedisStore(client, "webhook-safe:", 7 * 24 * 60 * 60 * 1000);
```

The constructor arguments are:

```ts
new RedisStore(client, prefix, completedTtlMs);
```

`completedTtlMs` must be a finite number greater than `0`.

The prefix defaults to:

```text
webhook-safe:
```

## Production considerations

### Use shared storage

If your application runs multiple processes or instances, use a shared idempotency store such as Redis.

An in-memory store cannot coordinate claims between separate processes.

### Choose an appropriate lease

The processing lease should be long enough for normal webhook processing.

If a handler can legitimately run longer than the lease, another worker may reclaim the event after the lease expires.

### Understand completed-event retention

With Redis, completed events are retained for 24 hours by default.

After a completed Redis entry expires, the same event ID can be processed again if the webhook provider redelivers it.

Choose a retention period appropriate for your provider's retry behavior and your application's requirements.

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

```ts
"processed" | "duplicate";
```

`"processed"` means the current call acquired the processing claim, successfully ran the handler, and marked the event completed.

`"duplicate"` means another processing claim already exists or the event has already been completed.

### `IdempotencyStore`

The store interface allows custom idempotency implementations.

```ts
interface IdempotencyStore {
  get(key: string): Promise<EventStatus | null>;

  claim(key: string, leaseMs: number): Promise<IdempotencyClaim | null>;

  release(key: string, claim: IdempotencyClaim): Promise<void>;

  setCompleted(key: string, claim: IdempotencyClaim): Promise<void>;
}
```

### `MemoryStore`

In-memory idempotency store.

```ts
import { MemoryStore } from "webhook-safe";

const store = new MemoryStore();
```

### `RedisStore`

Redis-backed idempotency store.

```ts
import { RedisStore } from "webhook-safe";

const store = new RedisStore(client);
```

### `verifyHmacSignature()`

Verifies an HMAC-SHA256 signature.

```ts
verifyHmacSignature(payload, signature, secret);
```

The signature may be provided as a raw hexadecimal digest or with the common `sha256=` prefix:

```ts
verifyHmacSignature(payload, "abc123...", secret);
verifyHmacSignature(payload, "sha256=abc123...", secret);
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

### `isWebhookEvent()`

Runtime validation for the generic webhook event shape.

```ts
import { isWebhookEvent } from "webhook-safe";

if (!isWebhookEvent(value)) {
  throw new Error("Invalid webhook event");
}
```

### `IdempotencyClaim`

Represents ownership of an active processing claim.

```ts
interface IdempotencyClaim {
  token: string;
}
```

Claim ownership is used to ensure that an expired worker cannot modify a newer worker's claim.

### `EventStatus`

The possible stored event states:

```ts
type EventStatus = "processing" | "completed";
```

## Framework agnostic

`webhook-safe` does not depend on Express, Fastify, Hono, Next.js, NestJS, or another HTTP framework.

Verify the provider signature using the raw request body, parse the event, and pass it to `handleWebhook()`.

This allows the same idempotency logic to be used across different frameworks and runtimes.

## Security

Always verify the webhook signature before processing an untrusted webhook payload.

For HMAC verification, use the raw request body that was received from the provider.

Do not parse and re-serialize JSON before signature verification if your webhook provider signs the raw request body.

## Roadmap

Potential future additions include:

- PostgreSQL store
- Stripe integration
- GitHub integration
- Shopify integration
- Replay protection
- Framework integrations
- Operational dashboard
- Lease renewal / heartbeat support

## License

MIT
