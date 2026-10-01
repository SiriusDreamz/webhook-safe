import { createHmac, timingSafeEqual } from "node:crypto";

import { WebhookSignatureError } from "./errors.js";

export interface ShopifySignatureOptions {
  secret: string;
}

export function verifyShopifySignature(
  payload: string | Buffer,
  signatureHeader: string,
  options: ShopifySignatureOptions,
): void {
  const expectedSignature = createHmac("sha256", options.secret)
    .update(payload)
    .digest();

  let actualSignature: Buffer;

  try {
    actualSignature = Buffer.from(signatureHeader, "base64");
  } catch {
    throw new WebhookSignatureError();
  }

  if (
    actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    throw new WebhookSignatureError();
  }
}
