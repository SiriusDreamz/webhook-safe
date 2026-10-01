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
  options: WebhookHandlerOptions<T>,
): Promise<"processed" | "duplicate"> {
  const key = options.getKey(event);
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;

  validateLeaseMs(leaseMs);

  const claim = await options.store.claim(key, leaseMs);

  if (!claim) {
    return "duplicate";
  }

  const heartbeatIntervalMs = Math.max(1, Math.floor(leaseMs / 3));

  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  let stopHeartbeat = false;

  const heartbeat = async (): Promise<void> => {
    while (!stopHeartbeat) {
      await new Promise<void>((resolve) => {
        heartbeatTimer = setTimeout(resolve, heartbeatIntervalMs);
      });

      if (stopHeartbeat) {
        return;
      }

      const renewed = await options.store.renew(key, claim, leaseMs);

      if (!renewed) {
        throw new Error("Webhook processing lease was lost");
      }
    }
  };

  const handlerPromise = options.handler(event);
  const heartbeatPromise = heartbeat();

  try {
    await Promise.race([handlerPromise, heartbeatPromise]);

    stopHeartbeat = true;

    if (heartbeatTimer !== undefined) {
      clearTimeout(heartbeatTimer);
    }

    await handlerPromise;
    await options.store.setCompleted(key, claim);

    return "processed";
  } catch (error) {
    stopHeartbeat = true;

    if (heartbeatTimer !== undefined) {
      clearTimeout(heartbeatTimer);
    }

    await options.store.release(key, claim);
    throw error;
  }
}
