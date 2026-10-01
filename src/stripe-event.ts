import { verifyStripeSignature } from "./stripe.js";

export interface StripeWebhookEvent<T = unknown> {
  id: string;
  object: "event";
  type: string;
  data: {
    object: T;
  };
}

export interface ParseStripeWebhookOptions {
  secret: string;
  toleranceSeconds?: number;
  now?: number;
}

export function parseStripeWebhook<T = unknown>(
  payload: string | Buffer,
  signatureHeader: string,
  options: ParseStripeWebhookOptions,
): StripeWebhookEvent<T> {
  const valid = verifyStripeSignature(payload, signatureHeader, options);

  if (!valid) {
    throw new Error("Invalid Stripe webhook signature");
  }

  const payloadString = Buffer.isBuffer(payload)
    ? payload.toString("utf8")
    : payload;

  let value: unknown;

  try {
    value = JSON.parse(payloadString);
  } catch {
    throw new Error("Invalid Stripe webhook payload");
  }

  if (!isStripeWebhookEvent<T>(value)) {
    throw new Error("Invalid Stripe webhook event");
  }

  return value;
}

function isStripeWebhookEvent<T>(
  value: unknown,
): value is StripeWebhookEvent<T> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const event = value as Record<string, unknown>;

  if (
    typeof event.id !== "string" ||
    event.id.length === 0 ||
    event.object !== "event" ||
    typeof event.type !== "string" ||
    event.type.length === 0 ||
    typeof event.data !== "object" ||
    event.data === null
  ) {
    return false;
  }

  const data = event.data as Record<string, unknown>;

  return "object" in data;
}
