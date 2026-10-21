import { createHmac, timingSafeEqual } from "node:crypto";
import { WebhookSignatureError } from "./errors.js";
import { signingSecrets, type SigningSecretRotationOptions } from "./signing-secrets.js";

export function verifyHmacSignature(
  payload: string | Buffer,
  signature: string,
  secret: string,
  options: SigningSecretRotationOptions = {},
): void {
  const secrets = signingSecrets(secret, options);
  const normalizedSignature = signature.startsWith("sha256=")
    ? signature.slice("sha256=".length)
    : signature;

  const signatureBuffer = Buffer.from(normalizedSignature, "utf8");
  let valid = false;
  for (const candidate of secrets) {
    const expected = createHmac("sha256", candidate).update(payload).digest("hex");
    const expectedBuffer = Buffer.from(expected, "utf8");
    const matched = expectedBuffer.length === signatureBuffer.length &&
      timingSafeEqual(expectedBuffer, signatureBuffer);
    valid = matched || valid;
  }
  if (!valid) {
    throw new WebhookSignatureError();
  }
}
