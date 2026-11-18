import { createHmac, timingSafeEqual } from "node:crypto";
import { WebhookSignatureError } from "./errors.js";
import { signingSecrets, type SigningSecretRotationOptions } from "./signing-secrets.js";

export interface CloudSignatureOptions extends SigningSecretRotationOptions {
  secret: string;
  /** webhook-safe-id: stable Cloud event identity, retained across retries/replay. */
  deliveryId: string;
  /** webhook-safe-timestamp: canonical Unix timestamp in seconds. */
  timestamp: string;
  /** Between 0 and 300 seconds, defaults to 300. */
  toleranceSeconds?: number;
  /** Current time in milliseconds, primarily for deterministic tests. */
  now?: number;
}

/** Verify the original raw body before parsing or performing business work. */
export function verifyCloudSignature(
  payload: string | Buffer,
  signatureHeader: string,
  options: CloudSignatureOptions,
): void {
  const secrets = signingSecrets(options.secret, options);
  if (secrets.some(secret => typeof secret !== "string" || secret.trim().length === 0 || Buffer.byteLength(secret, "utf8") < 32
    || Buffer.byteLength(secret, "utf8") > 4096 || Buffer.from(secret, "utf8").toString("utf8") !== secret)) {
    throw new Error("Cloud signing secrets must contain 32 to 4096 UTF-8 bytes");
  }
  const tolerance = options.toleranceSeconds ?? 300;
  const now = options.now ?? Date.now();
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 300)
    throw new Error("Cloud toleranceSeconds must be between 0 and 300");
  if (!Number.isFinite(now) || now < 0)
    throw new Error("Cloud now must be a finite non-negative timestamp");
  if (typeof options.deliveryId !== "string" || options.deliveryId.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(options.deliveryId)
    || typeof options.timestamp !== "string" || !/^(0|[1-9][0-9]{0,15})$/.test(options.timestamp)
    || !Number.isSafeInteger(Number(options.timestamp))
    || options.timestamp !== String(Number(options.timestamp))
    || Math.abs(now / 1000 - Number(options.timestamp)) > tolerance
    || typeof signatureHeader !== "string" || signatureHeader.length > 206
    || signatureHeader !== signatureHeader.trim()
    || !/^v1=[0-9a-f]{64}(?:, ?v1=[0-9a-f]{64}){0,2}$/.test(signatureHeader)) {
    throw new WebhookSignatureError();
  }
  const signatures = signatureHeader.split(",").map(value => Buffer.from(value.trim().slice(3), "hex"));
  let valid = false;
  // Evaluate every configured secret and candidate without disclosing a key index.
  for (const secret of secrets) {
    const expected = createHmac("sha256", secret)
      .update(`v1\n${options.timestamp}\n${options.deliveryId}\n`).update(payload).digest();
    for (const signature of signatures) valid = timingSafeEqual(signature, expected) || valid;
  }
  if (!valid) throw new WebhookSignatureError();
}
