import { createHmac, timingSafeEqual } from "node:crypto";
import { WebhookSignatureError } from "./errors.js";
import { signingSecrets, type SigningSecretRotationOptions } from "./signing-secrets.js";

export interface LemonSqueezySignatureOptions extends SigningSecretRotationOptions {
  /** Signing secret configured on the Lemon Squeezy webhook. */
  secret: string;
}

/**
 * Verify a Lemon Squeezy `X-Signature` header.
 * The signature is the lowercase hex HMAC-SHA256 digest of the raw body.
 * Returns normally on success and throws `WebhookSignatureError` on failure.
 */
export function verifyLemonSqueezySignature(
  payload: string | Buffer,
  signatureHeader: string,
  options: LemonSqueezySignatureOptions,
): void {
  if (typeof options.secret !== "string" || options.secret.length === 0) {
    throw new Error("Lemon Squeezy signing secret is required");
  }
  const secrets = signingSecrets(options.secret, options);
  if (typeof signatureHeader !== "string" || !/^[0-9a-f]{64}$/.test(signatureHeader)) {
    throw new WebhookSignatureError();
  }
  const actual = Buffer.from(signatureHeader, "utf8");
  let valid = false;
  for (const secret of secrets) {
    const expected = Buffer.from(
      createHmac("sha256", secret).update(payload).digest("hex"),
      "utf8",
    );
    valid =
      (actual.length === expected.length && timingSafeEqual(actual, expected)) || valid;
  }
  if (!valid) throw new WebhookSignatureError();
}
