import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { parseStripeWebhook } from "./stripe-event.js";

const secret = "whsec_test_secret";
const timestamp = 1_700_000_000;
const now = timestamp * 1000;

function createSignature(payload: string, timestampValue = timestamp): string {
  return createHmac("sha256", secret)
    .update(`${timestampValue}.${payload}`)
    .digest("hex");
}

function createHeader(payload: string): string {
  return `t=${timestamp},v1=${createSignature(payload)}`;
}

describe("parseStripeWebhook", () => {
  it("verifies and parses a valid Stripe event", () => {
    const payload = JSON.stringify({
      id: "evt_123",
      object: "event",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_123",
          object: "payment_intent",
        },
      },
    });

    const event = parseStripeWebhook(payload, createHeader(payload), {
      secret,
      now,
    });

    expect(event.id).toBe("evt_123");
    expect(event.object).toBe("event");
    expect(event.type).toBe("payment_intent.succeeded");
    expect(event.data.object).toEqual({
      id: "pi_123",
      object: "payment_intent",
    });
  });

  it("accepts a Buffer payload", () => {
    const payload = JSON.stringify({
      id: "evt_123",
      object: "event",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_123",
        },
      },
    });

    const event = parseStripeWebhook(
      Buffer.from(payload),
      createHeader(payload),
      {
        secret,
        now,
      },
    );

    expect(event.id).toBe("evt_123");
    expect(event.type).toBe("checkout.session.completed");
  });

  it("preserves the generic data object type", () => {
    interface PaymentIntent {
      id: string;
      amount: number;
    }

    const payload = JSON.stringify({
      id: "evt_123",
      object: "event",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_123",
          amount: 5000,
        },
      },
    });

    const event = parseStripeWebhook<PaymentIntent>(
      payload,
      createHeader(payload),
      {
        secret,
        now,
      },
    );

    expect(event.data.object.id).toBe("pi_123");
    expect(event.data.object.amount).toBe(5000);
  });

  it("rejects an invalid signature", () => {
    const payload = JSON.stringify({
      id: "evt_123",
      object: "event",
      type: "payment_intent.succeeded",
      data: {
        object: {},
      },
    });

    expect(() =>
      parseStripeWebhook(payload, `t=${timestamp},v1=deadbeef`, {
        secret,
        now,
      }),
    ).toThrow("Invalid Stripe webhook signature");
  });

  it("rejects malformed JSON after signature verification", () => {
    const payload = "{not-json";

    expect(() =>
      parseStripeWebhook(payload, createHeader(payload), {
        secret,
        now,
      }),
    ).toThrow("Invalid Stripe webhook payload");
  });

  it("rejects a payload without an event id", () => {
    const payload = JSON.stringify({
      object: "event",
      type: "payment_intent.succeeded",
      data: {
        object: {},
      },
    });

    expect(() =>
      parseStripeWebhook(payload, createHeader(payload), {
        secret,
        now,
      }),
    ).toThrow("Invalid Stripe webhook event");
  });

  it("rejects a payload that is not a Stripe event", () => {
    const payload = JSON.stringify({
      id: "evt_123",
      object: "customer",
      type: "customer.created",
      data: {
        object: {},
      },
    });

    expect(() =>
      parseStripeWebhook(payload, createHeader(payload), {
        secret,
        now,
      }),
    ).toThrow("Invalid Stripe webhook event");
  });

  it("rejects an event without a type", () => {
    const payload = JSON.stringify({
      id: "evt_123",
      object: "event",
      data: {
        object: {},
      },
    });

    expect(() =>
      parseStripeWebhook(payload, createHeader(payload), {
        secret,
        now,
      }),
    ).toThrow("Invalid Stripe webhook event");
  });

  it("rejects an event without data.object", () => {
    const payload = JSON.stringify({
      id: "evt_123",
      object: "event",
      type: "payment_intent.succeeded",
      data: {},
    });

    expect(() =>
      parseStripeWebhook(payload, createHeader(payload), {
        secret,
        now,
      }),
    ).toThrow("Invalid Stripe webhook event");
  });
});
