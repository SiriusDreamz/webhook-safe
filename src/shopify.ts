import { createHmac, timingSafeEqual } from "node:crypto";

import { WebhookSignatureError } from "./errors.js";
import { signingSecrets, type SigningSecretRotationOptions } from "./signing-secrets.js";

export interface ShopifySignatureOptions extends SigningSecretRotationOptions {
  secret: string;
}

export function verifyShopifySignature(
  payload: string | Buffer,
  signatureHeader: string,
  options: ShopifySignatureOptions,
): void {
  const secrets = signingSecrets(options.secret, options);
  // Buffer's Base64 decoder ignores malformed characters. Require canonical
  // SHA-256 Base64 rather than accepting decorated or truncated headers.
  if (typeof signatureHeader !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(signatureHeader)) {
    throw new WebhookSignatureError();
  }
  let actualSignature: Buffer;

  try {
    actualSignature = Buffer.from(signatureHeader, "base64");
    if (actualSignature.toString("base64") !== signatureHeader) throw new WebhookSignatureError();
  } catch {
    throw new WebhookSignatureError();
  }

  let valid = false;
  for (const candidate of secrets) {
    const expectedSignature = createHmac("sha256", candidate).update(payload).digest();
    const matched = actualSignature.length === expectedSignature.length &&
      timingSafeEqual(actualSignature, expectedSignature);
    valid = matched || valid;
  }
  if (!valid) {
    throw new WebhookSignatureError();
  }
}
