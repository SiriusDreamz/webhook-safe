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
  const toleranceSeconds =
    options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;

  if (!Number.isFinite(toleranceSeconds) || toleranceSeconds < 0) {
    throw new Error("toleranceSeconds must be a finite non-negative number");
  }

  const now = options.now ?? Date.now();
  if (!Number.isFinite(now) || now < 0) {
    throw new Error("now must be a finite non-negative timestamp");
  }
  if (typeof options.secret !== "string" || options.secret.length === 0) {
    throw new Error("Stripe signing secret is required");
  }
  const timestamp = getStripeTimestamp(signatureHeader);
  const signatures = getStripeV1Signatures(signatureHeader);
  if (timestamp === null || signatures.length === 0) return false;
  const ageSeconds = Math.abs(now / 1000 - timestamp);

  if (ageSeconds > toleranceSeconds) {
    return false;
  }

  const expectedSignature = createHmac("sha256", options.secret)
    .update(`${timestamp}.`).update(payload)
    .digest("hex");

  return signatures.some((signature) =>
    safeEqualHex(signature, expectedSignature),
  );
}

function getStripeTimestamp(signatureHeader: string): number | null {
  if (typeof signatureHeader !== "string") return null;
  const parts = signatureHeader.split(",");
  let timestamp: number | null = null;
  for (const part of parts) {
    const [key, ...values] = part.split("=");
    const value = values.join("=");

    if (key?.trim() === "t") {
      if (timestamp !== null || !value || !/^(0|[1-9][0-9]{0,15})$/.test(value.trim())
          || !Number.isSafeInteger(Number(value.trim()))) return null;
      timestamp = Number(value.trim());
    }
  }

  return timestamp;
}

function getStripeV1Signatures(signatureHeader: string): string[] {
  if (typeof signatureHeader !== "string") return [];
  return signatureHeader
    .split(",")
    .map((part) => {
      const [key, ...values] = part.split("=");
      return [key, values.join("=")];
    })
    .filter(([key, value]) => key?.trim() === "v1" && value)
    .map(([, value]) => value!.trim());
}

function safeEqualHex(actual: string, expected: string): boolean {
  if (!/^[0-9a-fA-F]{64}$/.test(actual)) {
    return false;
  }

  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}
