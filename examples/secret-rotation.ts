import {
  handleWebhook, parseStripeWebhook,
  type IdempotencyStore, type StripeWebhookEvent,
} from "../src/index.js";

// Prepared for webhook-safe 0.8.0. After publication, import from "webhook-safe".
// Load keys from protected server configuration, never from the incoming request.
// Remove previousSecrets after the provider's operator-controlled overlap window.
export async function processStripeDelivery(
  rawBody: Buffer,
  signatureHeader: string,
  currentSecret: string,
  previousSecrets: readonly string[],
  store: IdempotencyStore,
  handler: (event: StripeWebhookEvent) => Promise<void>,
): Promise<"processed" | "duplicate"> {
  const event = parseStripeWebhook(rawBody, signatureHeader, {
    secret: currentSecret,
    previousSecrets,
  });
  // Keep the same identity when the provider signs a delivery with another key.
  return handleWebhook(event, { store, getKey: event => event.id, handler });
}
