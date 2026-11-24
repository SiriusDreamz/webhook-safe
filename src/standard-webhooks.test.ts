import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyStandardWebhookSignature, WebhookSignatureError } from "./index.js";

/** Official vector from the Standard Webhooks JavaScript library and the Svix verifier guide. */
const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const id = "msg_p5jXN8AQM9LWM0D4loKWxJek";
const timestamp = "1614265330";
const payload = '{"test": 2432232314}';
const signature = "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=";
const now = Number(timestamp) * 1000;

const options = { secret, id, timestamp, now };

function sign(
  body: string | Buffer,
  key: string,
  messageId = id,
  messageTimestamp = timestamp,
): string {
  const encoded = key.startsWith("whsec_") ? key.slice("whsec_".length) : key;
  const digest = createHmac("sha256", Buffer.from(encoded, "base64"))
    .update(`${messageId}.${messageTimestamp}.`)
    .update(body)
    .digest("base64");
  return `v1,${digest}`;
}

describe("verifyStandardWebhookSignature", () => {
  it("accepts the Standard Webhooks reference vector with whsec_ and raw base64 secrets", () => {
    expect(() => verifyStandardWebhookSignature(payload, signature, options)).not.toThrow();
    expect(() =>
      verifyStandardWebhookSignature(payload, signature, {
        ...options,
        secret: secret.slice("whsec_".length),
      }),
    ).not.toThrow();
    expect(() =>
      verifyStandardWebhookSignature(Buffer.from(payload), signature, options),
    ).not.toThrow();
  });

  it("accepts the same values when they arrive in Svix header aliases", () => {
    const svix = {
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": signature,
    };
    expect(() =>
      verifyStandardWebhookSignature(payload, svix["svix-signature"], {
        secret,
        id: svix["svix-id"],
        timestamp: svix["svix-timestamp"],
        now,
      }),
    ).not.toThrow();
  });

  it("accepts a matching v1 among other space-separated signatures", () => {
    const header = [
      "v1,Ceo5qEr07ixe2NLpvHk3FH9bwy/WavXrAFQ/9tdO6mc=",
      "v2,Ceo5qEr07ixe2NLpvHk3FH9bwy/WavXrAFQ/9tdO6mc=",
      "v1,not-base64!",
      signature,
      "v2a,kG9XaxZjAEpKB8KeQQb5G1Xp73YH5Rf5gxoWe7cg1kYMiyspdtZXe9w+dAwKeOurAwxfqmlOG/QR4m9s37DzAg==",
    ].join(" ");
    expect(() => verifyStandardWebhookSignature(payload, header, options)).not.toThrow();
  });

  it("accepts a previous whsec_ secret and stops accepting it when overlap ends", () => {
    const previous = "whsec_5WbX5kEWLlfzsGNjH64I8lOOqUB6e8FH";
    const header = sign(payload, previous);
    expect(() =>
      verifyStandardWebhookSignature(payload, header, {
        ...options,
        previousSecrets: [previous],
      }),
    ).not.toThrow();
    expect(() => verifyStandardWebhookSignature(payload, header, options)).toThrow(
      WebhookSignatureError,
    );
  });

  it("preserves non-UTF8 body bytes", () => {
    const body = Buffer.from([0xff, 0xfe, 0, 13, 10]);
    const header = sign(body, secret);
    expect(() => verifyStandardWebhookSignature(body, header, options)).not.toThrow();
    expect(() =>
      verifyStandardWebhookSignature(Buffer.from(body.toString("utf8")), header, options),
    ).toThrow(WebhookSignatureError);
    expect(() =>
      verifyStandardWebhookSignature(`${payload} `, signature, options),
    ).toThrow(WebhookSignatureError);
  });

  it("rejects a tampered body, the wrong secret, and a non-v1 signature", () => {
    expect(() =>
      verifyStandardWebhookSignature('{"test": 2432232315}', signature, options),
    ).toThrow(WebhookSignatureError);
    expect(() =>
      verifyStandardWebhookSignature(payload, signature, {
        ...options,
        secret: "whsec_5WbX5kEWLlfzsGNjH64I8lOOqUB6e8FH",
      }),
    ).toThrow(WebhookSignatureError);
    expect(() =>
      verifyStandardWebhookSignature(payload, signature.replace("v1,", "v2,"), options),
    ).toThrow(WebhookSignatureError);
    expect(() =>
      verifyStandardWebhookSignature(payload, signature.replace("v1,", "v2a,"), options),
    ).toThrow(WebhookSignatureError);
  });

  it("rejects expired and future timestamps at the whole-second boundary", () => {
    expect(() =>
      verifyStandardWebhookSignature(payload, signature, {
        ...options,
        now: now + 300_000,
      }),
    ).not.toThrow();
    expect(() =>
      verifyStandardWebhookSignature(payload, signature, {
        ...options,
        now: now + 300_999,
      }),
    ).not.toThrow();
    expect(() =>
      verifyStandardWebhookSignature(payload, signature, {
        ...options,
        now: now - 300_000,
      }),
    ).not.toThrow();
    expect(() =>
      verifyStandardWebhookSignature(payload, signature, {
        ...options,
        now: now + 301_000,
      }),
    ).toThrow(WebhookSignatureError);
    expect(() =>
      verifyStandardWebhookSignature(payload, signature, {
        ...options,
        now: now - 300_001,
      }),
    ).toThrow(WebhookSignatureError);
    expect(() =>
      verifyStandardWebhookSignature(payload, signature, {
        ...options,
        now: now + 2_000,
        toleranceSeconds: 1,
      }),
    ).toThrow(WebhookSignatureError);
  });

  it("rejects malformed, missing, and dotted identifiers", () => {
    const dotted = "msg.bad";
    expect(() =>
      verifyStandardWebhookSignature(payload, sign(payload, secret, dotted), {
        ...options,
        id: dotted,
      }),
    ).toThrow(WebhookSignatureError);
    for (const header of ["", "v1,", "v1,abc", ` ${signature}`, signature.toUpperCase()]) {
      expect(() => verifyStandardWebhookSignature(payload, header, options)).toThrow(
        WebhookSignatureError,
      );
    }
    for (const value of ["", "1614265330.0", "1614265330 ", "1e9", "-1", "hello"]) {
      expect(() =>
        verifyStandardWebhookSignature(payload, signature, { ...options, timestamp: value }),
      ).toThrow(WebhookSignatureError);
    }
    expect(() =>
      verifyStandardWebhookSignature(payload, signature, { ...options, id: "" }),
    ).toThrow(WebhookSignatureError);
  });

  it("rejects invalid secret, tolerance, clock, and rotation configuration", () => {
    expect(() =>
      verifyStandardWebhookSignature(payload, signature, { ...options, secret: "" }),
    ).toThrow("Standard Webhooks signing secret is required");
    for (const value of ["whsec_", "not base64", "whsec_****", "whsec_A", "whsec_AA="]) {
      expect(() =>
        verifyStandardWebhookSignature(payload, signature, { ...options, secret: value }),
      ).toThrow("Invalid Standard Webhooks signing secret");
    }
    for (const toleranceSeconds of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        verifyStandardWebhookSignature(payload, signature, { ...options, toleranceSeconds }),
      ).toThrow("Standard Webhooks toleranceSeconds must be a finite non-negative number");
    }
    for (const clock of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        verifyStandardWebhookSignature(payload, signature, { ...options, now: clock }),
      ).toThrow("Standard Webhooks now must be a finite non-negative timestamp");
    }
    expect(() =>
      verifyStandardWebhookSignature(payload, signature, {
        ...options,
        previousSecrets: [secret],
      }),
    ).toThrow("Invalid signing secret rotation configuration");
  });
});
