import { createHmac, timingSafeEqual } from "node:crypto";
import { WebhookSignatureError } from "./errors.js";
import { signingSecrets, type SigningSecretRotationOptions } from "./signing-secrets.js";

export interface StandardWebhookSignatureOptions extends SigningSecretRotationOptions {
  /**
   * Signing secret as `whsec_` plus standard base64, or the same base64 without
   * the prefix. The HMAC key is the decoded bytes, not the prefixed string.
   */
  secret: string;
  /** `webhook-id`, or the identical Svix alias `svix-id`. */
  id: string;
  /** `webhook-timestamp`, or the identical Svix alias `svix-timestamp`. Unix seconds. */
  timestamp: string;
  /**
   * Maximum absolute difference, in whole seconds, between `timestamp` and `now`.
   * Defaults to 300, the tolerance in the Standard Webhooks reference libraries.
   */
  toleranceSeconds?: number;
  /** Current time in milliseconds. Primarily for deterministic tests. */
  now?: number;
}

const DEFAULT_TOLERANCE_SECONDS = 300;
const SECRET_PREFIX = "whsec_";

/**
 * Verify a Standard Webhooks v1 HMAC-SHA256 signature over the raw body.
 * `webhook-signature` and `svix-signature` carry the same space-separated value.
 * Returns normally on success and throws `WebhookSignatureError` on failure.
 */
export function verifyStandardWebhookSignature(
  payload: string | Buffer,
  signatureHeader: string,
  options: StandardWebhookSignatureOptions,
): void {
  const toleranceSeconds = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (!Number.isFinite(toleranceSeconds) || toleranceSeconds < 0) {
    throw new Error(
      "Standard Webhooks toleranceSeconds must be a finite non-negative number",
    );
  }
  const now = options.now ?? Date.now();
  if (!Number.isFinite(now) || now < 0) {
    throw new Error("Standard Webhooks now must be a finite non-negative timestamp");
  }
  if (typeof options.secret !== "string" || options.secret.length === 0) {
    throw new Error("Standard Webhooks signing secret is required");
  }
  const keys = signingSecrets(options.secret, options).map(decodeStandardWebhookSecret);

  if (!isMessageId(options.id) || !isUnixSeconds(options.timestamp)) {
    throw new WebhookSignatureError();
  }
  const skewSeconds = Math.abs(Math.floor(now / 1000) - Number(options.timestamp));
  if (skewSeconds > toleranceSeconds) {
    throw new WebhookSignatureError();
  }

  const candidates = v1Signatures(signatureHeader);
  if (candidates.length === 0) {
    throw new WebhookSignatureError();
  }

  let valid = false;
  for (const key of keys) {
    const expected = createHmac("sha256", key)
      .update(`${options.id}.${options.timestamp}.`)
      .update(payload)
      .digest();
    for (const actual of candidates) {
      valid =
        (actual.length === expected.length && timingSafeEqual(actual, expected)) ||
        valid;
    }
  }
  if (!valid) throw new WebhookSignatureError();
}

function isMessageId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && !/[\s.\u0000]/.test(id);
}

function isUnixSeconds(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(0|[1-9][0-9]{0,15})$/.test(value) &&
    Number.isSafeInteger(Number(value))
  );
}

function decodeStandardWebhookSecret(secret: string): Buffer {
  const encoded = secret.startsWith(SECRET_PREFIX)
    ? secret.slice(SECRET_PREFIX.length)
    : secret;
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  if (
    encoded.length === 0 ||
    encoded.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ||
    (encoded.match(/=/g) ?? []).length !== padding
  ) {
    throw new Error("Invalid Standard Webhooks signing secret");
  }
  const key = Buffer.from(encoded, "base64");
  const canonical = key.toString("base64");
  const unpadded = canonical.replace(/=+$/g, "");
  if (
    key.length === 0 ||
    (encoded !== canonical && (encoded !== unpadded || encoded.includes("=")))
  ) {
    throw new Error("Invalid Standard Webhooks signing secret");
  }
  return key;
}

/** Space-separated `v1,<base64>` signatures. Other versions are ignored. */
function v1Signatures(signatureHeader: string): Buffer[] {
  if (
    typeof signatureHeader !== "string" ||
    signatureHeader.length === 0 ||
    signatureHeader !== signatureHeader.trim()
  ) {
    return [];
  }
  const signatures: Buffer[] = [];
  for (const part of signatureHeader.split(" ")) {
    if (part.length === 0) continue;
    const match = /^v1,([A-Za-z0-9+/]{43}=)$/.exec(part);
    if (!match?.[1]) continue;
    const encoded = match[1];
    const decoded = Buffer.from(encoded, "base64");
    if (decoded.length === 32 && decoded.toString("base64") === encoded) {
      signatures.push(decoded);
    }
  }
  return signatures;
}
