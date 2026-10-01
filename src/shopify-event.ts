import { verifyShopifySignature } from "./shopify.js";

export interface ShopifyWebhookEvent<T = unknown> {
  webhookId: string;
  topic: string;
  payload: T;
}

export interface ParseShopifyWebhookOptions {
  secret: string;
  topic: string;
  webhookId: string;
}

export function parseShopifyWebhook<T = unknown>(
  payload: string | Buffer,
  signatureHeader: string,
  options: ParseShopifyWebhookOptions,
): ShopifyWebhookEvent<T> {
  verifyShopifySignature(payload, signatureHeader, {
    secret: options.secret,
  });

  if (typeof options.topic !== "string" || options.topic.trim().length === 0) {
    throw new Error("Shopify webhook topic is required");
  }

  if (
    typeof options.webhookId !== "string" ||
    options.webhookId.trim().length === 0
  ) {
    throw new Error("Shopify webhook ID is required");
  }

  const payloadString = Buffer.isBuffer(payload)
    ? payload.toString("utf8")
    : payload;

  let parsed: unknown;

  try {
    parsed = JSON.parse(payloadString);
  } catch {
    throw new Error("Invalid Shopify webhook payload");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Invalid Shopify webhook payload");
  }

  return {
    webhookId: options.webhookId,
    topic: options.topic,
    payload: parsed as T,
  };
}
