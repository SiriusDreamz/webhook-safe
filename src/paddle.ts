import { createHmac, timingSafeEqual } from "node:crypto";
import { WebhookSignatureError } from "./errors.js";
import { signingSecrets, type SigningSecretRotationOptions } from "./signing-secrets.js";

export interface PaddleSignatureOptions extends SigningSecretRotationOptions {
  /** Notification destination secret key. This string is the HMAC key. */
  secret: string;
  /**
   * Maximum absolute skew between the `ts` value and `now`, in seconds.
   * Defaults to 5, the tolerance used by Paddle's SDK.
   */
  toleranceSeconds?: number;
  /** Current time in milliseconds. Primarily for deterministic tests. */
  now?: number;
}

const DEFAULT_TOLERANCE_SECONDS = 5;

/**
 * Verify a Paddle Billing `Paddle-Signature` header against the raw body.
 * The signed content is `${ts}:` followed by the original body bytes.
 * Returns normally on success and throws `WebhookSignatureError` on failure.
 */
export function verifyPaddleSignature(
  payload: string | Buffer,
  signatureHeader: string,
  options: PaddleSignatureOptions,
): void {
  const toleranceSeconds = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (!Number.isFinite(toleranceSeconds) || toleranceSeconds < 0) {
    throw new Error("Paddle toleranceSeconds must be a finite non-negative number");
  }
  const now = options.now ?? Date.now();
  if (!Number.isFinite(now) || now < 0) {
    throw new Error("Paddle now must be a finite non-negative timestamp");
  }
  if (typeof options.secret !== "string" || options.secret.length === 0) {
    throw new Error("Paddle signing secret is required");
  }
  const secrets = signingSecrets(options.secret, options);
  const parsed = parsePaddleSignature(signatureHeader);
  if (!parsed) throw new WebhookSignatureError();

  const ageMs = Math.abs(now - Number(parsed.timestamp) * 1000);
  if (ageMs > toleranceSeconds * 1000) throw new WebhookSignatureError();

  let valid = false;
  for (const secret of secrets) {
    const expected = Buffer.from(
      createHmac("sha256", secret).update(`${parsed.timestamp}:`).update(payload).digest("hex"),
      "utf8",
    );
    for (const signature of parsed.signatures) {
      const actual = Buffer.from(signature, "utf8");
      valid =
        (actual.length === expected.length && timingSafeEqual(actual, expected)) || valid;
    }
  }
  if (!valid) throw new WebhookSignatureError();
}

function parsePaddleSignature(
  header: string,
): { timestamp: string; signatures: string[] } | null {
  if (typeof header !== "string" || header.length === 0) return null;
  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const part of header.split(";")) {
    if (part.length === 0) return null;
    const separator = part.indexOf("=");
    if (separator <= 0) return null;
    const key = part.slice(0, separator);
    const value = part.slice(separator + 1);
    if (key === "ts") {
      if (timestamp !== null || !isUnixSeconds(value)) return null;
      timestamp = value;
    } else if (key === "h1") {
      if (!/^[0-9a-f]{64}$/.test(value)) return null;
      signatures.push(value);
    } else {
      return null;
    }
  }
  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

function isUnixSeconds(value: string): boolean {
  return /^(0|[1-9][0-9]{0,15})$/.test(value) && Number.isSafeInteger(Number(value));
}
