import type { IdempotencyStore } from "./idempotency.js";
import { validateLeaseMs } from "./lease.js";

export interface WebhookHandlerOptions<T> {
  store: IdempotencyStore;
  getKey: (event: T) => string;
  handler: (event: T) => Promise<void>;
  leaseMs?: number;
}

const DEFAULT_LEASE_MS = 5 * 60 * 1000;

export async function handleWebhook<T>(
  event: T,
  options: WebhookHandlerOptions<T>
): Promise<"processed" | "duplicate"> {
  const key = options.getKey(event);
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;

  validateLeaseMs(leaseMs);

  const claim = await options.store.claim(key, leaseMs);

  if (!claim) {
    return "duplicate";
  }

  try {
    await options.handler(event);
    await options.store.setCompleted(key, claim);

    return "processed";
  } catch (error) {
    await options.store.release(key, claim);
    throw error;
  }
}
