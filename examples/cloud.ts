import { handleWebhook, verifyCloudSignature, type IdempotencyStore } from "../src/index.js";

// The HTTP adapter must bound the body size and supply one value for each
// webhook-safe-* header. Keep the original Buffer; do not parse JSON first.
export async function receiveCloudDelivery(
  rawBody: Buffer,
  headers: { deliveryId: string; timestamp: string; signature: string },
  options: { secret: string; previousSecrets?: readonly string[]; store: IdempotencyStore;
    handler: (body: Buffer) => Promise<void> },
): Promise<"processed" | "duplicate"> {
  verifyCloudSignature(rawBody, headers.signature, {
    secret: options.secret, previousSecrets: options.previousSecrets,
    deliveryId: headers.deliveryId, timestamp: headers.timestamp,
  });
  return handleWebhook(rawBody, {
    store: options.store, getKey: () => `cloud:${headers.deliveryId}`,
    handler: options.handler,
  });
}
