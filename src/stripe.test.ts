import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { verifyStripeSignature } from "./stripe.js";

const secret = "whsec_test_secret";
const timestamp = 1_700_000_000;
const now = timestamp * 1000;

function createSignature(payload: string, timestampValue = timestamp): string {
  return createHmac("sha256", secret)
    .update(`${timestampValue}.${payload}`)
    .digest("hex");
}

describe("verifyStripeSignature", () => {
  it("accepts a valid Stripe signature", () => {
    const payload = '{"id":"evt_123"}';
    const signature = createSignature(payload);

    expect(
      verifyStripeSignature(payload, `t=${timestamp},v1=${signature}`, {
        secret,
        now,
      }),
    ).toBe(true);
  });

  it("accepts Buffer payloads", () => {
    const payload = '{"id":"evt_123"}';
    const signature = createSignature(payload);

    expect(
      verifyStripeSignature(
        Buffer.from(payload),
        `t=${timestamp},v1=${signature}`,
        {
          secret,
          now,
        },
      ),
    ).toBe(true);
  });

  it("rejects a signature created with the wrong secret", () => {
    const payload = '{"id":"evt_123"}';

    const signature = createHmac("sha256", "wrong_secret")
      .update(`${timestamp}.${payload}`)
      .digest("hex");

    expect(
      verifyStripeSignature(payload, `t=${timestamp},v1=${signature}`, {
        secret,
        now,
      }),
    ).toBe(false);
  });

  it("rejects a signature for a modified payload", () => {
    const originalPayload = '{"id":"evt_123"}';
    const modifiedPayload = '{"id":"evt_456"}';
    const signature = createSignature(originalPayload);

    expect(
      verifyStripeSignature(modifiedPayload, `t=${timestamp},v1=${signature}`, {
        secret,
        now,
      }),
    ).toBe(false);
  });

  it("rejects an expired signature", () => {
    const payload = '{"id":"evt_123"}';
    const signature = createSignature(payload);

    expect(
      verifyStripeSignature(payload, `t=${timestamp},v1=${signature}`, {
        secret,
        now: now + 301_000,
      }),
    ).toBe(false);
  });

  it("accepts a custom timestamp tolerance", () => {
    const payload = '{"id":"evt_123"}';
    const signature = createSignature(payload);

    expect(
      verifyStripeSignature(payload, `t=${timestamp},v1=${signature}`, {
        secret,
        now: now + 600_000,
        toleranceSeconds: 600,
      }),
    ).toBe(true);
  });

  it("accepts any matching v1 signature", () => {
    const payload = '{"id":"evt_123"}';
    const signature = createSignature(payload);

    expect(
      verifyStripeSignature(
        payload,
        `t=${timestamp},v1=invalid,v1=${signature}`,
        {
          secret,
          now,
        },
      ),
    ).toBe(true);
  });

  it("rejects a header without a timestamp", () => {
    const payload = '{"id":"evt_123"}';
    const signature = createSignature(payload);

    expect(
      verifyStripeSignature(payload, `v1=${signature}`, {
        secret,
        now,
      }),
    ).toBe(false);
  });

  it("rejects a header without a v1 signature", () => {
    const payload = '{"id":"evt_123"}';

    expect(
      verifyStripeSignature(payload, `t=${timestamp},v0=abc123`, {
        secret,
        now,
      }),
    ).toBe(false);
  });

  it("rejects malformed signatures", () => {
    const payload = '{"id":"evt_123"}';

    expect(
      verifyStripeSignature(payload, `t=${timestamp},v1=not-hex`, {
        secret,
        now,
      }),
    ).toBe(false);
  });

  it("rejects an invalid tolerance", () => {
    const payload = '{"id":"evt_123"}';
    const signature = createSignature(payload);

    expect(() =>
      verifyStripeSignature(payload, `t=${timestamp},v1=${signature}`, {
        secret,
        now,
        toleranceSeconds: -1,
      }),
    ).toThrow("toleranceSeconds must be a finite non-negative number");
  });
});
