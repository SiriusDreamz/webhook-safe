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
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let renewal: Promise<void> | undefined;
  let leaseFailed = false;
  let leaseError: unknown;
  let rejectHeartbeat!: (error: unknown) => void;
  const heartbeatFailure = new Promise<never>((_, reject) => {
    rejectHeartbeat = reject;
  });

  const scheduleHeartbeat = (): void => {
    timer = setTimeout(() => {
      renewal = Promise.resolve().then(async () => {
        try {
          const renewed = await options.store.renew(key, claim, leaseMs);
          if (!renewed) throw new Error("Webhook processing lease was lost");
          if (!stopped) scheduleHeartbeat();
        } catch (error) {
          leaseFailed = true;
          leaseError = error;
          rejectHeartbeat(error);
        }
      });
    }, heartbeatIntervalMs);
  };

  const stopHeartbeat = async (): Promise<void> => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    // A renewal already sent to the store must settle before completion/release.
    await renewal;
  };

  try {
    scheduleHeartbeat();
    // Promise resolution also captures a synchronous throw from application code.
    const handlerPromise = Promise.resolve().then(() => options.handler(event));
    await Promise.race([handlerPromise, heartbeatFailure]);
    await stopHeartbeat();
    if (leaseFailed) throw leaseError;
    await options.store.setCompleted(key, claim);
    return "processed";
  } catch (error) {
    await stopHeartbeat();
    try {
      await options.store.release(key, claim);
    } catch (releaseError) {
      throw new AggregateError(
        [error, releaseError],
        "Webhook processing failed and its claim could not be released",
        { cause: error },
      );
    }
    throw error;
  }
}
