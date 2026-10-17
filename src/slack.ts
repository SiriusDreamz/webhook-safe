import { createHmac, timingSafeEqual } from "node:crypto";
import { WebhookSignatureError } from "./errors.js";

export interface SlackSignatureOptions {
  secret: string;
  timestamp: string;
  /** Timestamp tolerance in seconds, between 0 and 300. Defaults to 300. */
  toleranceSeconds?: number;
  /** Current time in milliseconds; primarily for deterministic tests. */
  now?: number;
}

export function verifySlackSignature(
  payload: string | Buffer,
  signatureHeader: string,
  options: SlackSignatureOptions,
): void {
  const tolerance = options.toleranceSeconds ?? 300;
  const now = options.now ?? Date.now();
  if (typeof options.secret !== "string" || options.secret.length === 0) {
    throw new Error("Slack signing secret is required");
  }
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 300) {
    throw new Error("Slack toleranceSeconds must be between 0 and 300");
  }
  if (!Number.isFinite(now) || now < 0) {
    throw new Error("Slack now must be a finite non-negative timestamp");
  }
  if (typeof options.timestamp !== "string" || !/^(0|[1-9][0-9]{0,15})$/.test(options.timestamp)
      || !Number.isSafeInteger(Number(options.timestamp))
      || Math.abs(now / 1000 - Number(options.timestamp)) > tolerance
      || typeof signatureHeader !== "string" || !/^v0=[0-9a-f]{64}$/.test(signatureHeader)) {
    throw new WebhookSignatureError();
  }
  // Preserve Buffer bytes: decoding and re-encoding can alter signed data.
  const expected = createHmac("sha256", options.secret)
    .update(`v0:${options.timestamp}:`).update(payload).digest();
  const actual = Buffer.from(signatureHeader.slice(3), "hex");
  if (!timingSafeEqual(actual, expected)) throw new WebhookSignatureError();
}
