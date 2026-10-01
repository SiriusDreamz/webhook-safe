import { createHmac, timingSafeEqual } from "node:crypto";

export interface StripeSignatureOptions {
  secret: string;
  toleranceSeconds?: number;
  now?: number;
}

const DEFAULT_TOLERANCE_SECONDS = 300;

export function verifyStripeSignature(
  payload: string | Buffer,
  signatureHeader: string,
  options: StripeSignatureOptions,
): boolean {
  const timestamp = getStripeTimestamp(signatureHeader);
  const signatures = getStripeV1Signatures(signatureHeader);

  if (timestamp === null || signatures.length === 0) {
    return false;
  }

  const toleranceSeconds =
    options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;

  if (!Number.isFinite(toleranceSeconds) || toleranceSeconds < 0) {
    throw new Error("toleranceSeconds must be a finite non-negative number");
  }

  const now = options.now ?? Date.now();
  const ageSeconds = Math.abs(now / 1000 - timestamp);

  if (ageSeconds > toleranceSeconds) {
    return false;
  }

  const payloadString = Buffer.isBuffer(payload)
    ? payload.toString("utf8")
    : payload;

  const signedPayload = `${timestamp}.${payloadString}`;

  const expectedSignature = createHmac("sha256", options.secret)
    .update(signedPayload)
    .digest("hex");

  return signatures.some((signature) =>
    safeEqualHex(signature, expectedSignature),
  );
}

function getStripeTimestamp(signatureHeader: string): number | null {
  const parts = signatureHeader.split(",");

  for (const part of parts) {
    const [key, value] = part.split("=", 2);

    if (key?.trim() === "t" && value) {
      const timestamp = Number(value.trim());

      return Number.isFinite(timestamp) ? timestamp : null;
    }
  }

  return null;
}

function getStripeV1Signatures(signatureHeader: string): string[] {
  return signatureHeader
    .split(",")
    .map((part) => part.split("=", 2))
    .filter(([key, value]) => key?.trim() === "v1" && value)
    .map(([, value]) => value!.trim());
}

function safeEqualHex(actual: string, expected: string): boolean {
  if (!/^[0-9a-fA-F]+$/.test(actual)) {
    return false;
  }

  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}
