import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { handleWebhook } from "./handler.js";
import { MemoryStore } from "./stores/memory.js";
import { parseStripeWebhook } from "./stripe-event.js";

const secret = "whsec_test_secret";
const timestamp = 1_700_000_000;
const now = timestamp * 1000;

function createSignatureHeader(payload: string): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");

  return `t=${timestamp},v1=${signature}`;
}

describe("Stripe webhook integration", () => {
  it("processes a signed Stripe event only once", async () => {
    const store = new MemoryStore();
    const handler = vi.fn(async () => {});

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

    const signatureHeader = createSignatureHeader(payload);

    const firstEvent = parseStripeWebhook(payload, signatureHeader, {
      secret,
      now,
    });

    const firstResult = await handleWebhook(firstEvent, {
      store,
      getKey: (event) => event.id,
      handler,
    });

    const duplicateEvent = parseStripeWebhook(payload, signatureHeader, {
      secret,
      now,
    });

    const duplicateResult = await handleWebhook(duplicateEvent, {
      store,
      getKey: (event) => event.id,
      handler,
    });

    expect(firstResult).toBe("processed");
    expect(duplicateResult).toBe("duplicate");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "evt_123",
        type: "payment_intent.succeeded",
      }),
    );
  });

  it("does not claim or process a Stripe event with an invalid signature", async () => {
    const store = new MemoryStore();
    const handler = vi.fn(async () => {});

    const payload = JSON.stringify({
      id: "evt_456",
      object: "event",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_123",
        },
      },
    });

    expect(() =>
      parseStripeWebhook(payload, `t=${timestamp},v1=deadbeef`, {
        secret,
        now,
      }),
    ).toThrow("Invalid Stripe webhook signature");

    expect(await store.get("evt_456")).toBeNull();
    expect(handler).not.toHaveBeenCalled();
  });
});
