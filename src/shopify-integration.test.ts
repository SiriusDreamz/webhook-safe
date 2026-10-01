import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { WebhookSignatureError } from "./errors.js";
import { handleWebhook } from "./handler.js";
import { parseShopifyWebhook } from "./shopify-event.js";
import { MemoryStore } from "./stores/memory.js";

function sign(payload: string | Buffer, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64");
}

describe("Shopify webhook integration", () => {
  const secret = "shopify-webhook-secret";

  it("processes a signed Shopify webhook only once", async () => {
    const rawPayload = JSON.stringify({
      id: 123,
      email: "customer@example.com",
      total_price: "49.99",
    });

    const event = parseShopifyWebhook(rawPayload, sign(rawPayload, secret), {
      secret,
      topic: "orders/create",
      webhookId: "webhook-123",
    });

    const store = new MemoryStore();
    const handler = vi.fn(async () => {});

    const options = {
      store,
      getKey: (webhook: typeof event) => webhook.webhookId,
      handler,
    };

    const first = await handleWebhook(event, options);

    const second = await handleWebhook(event, options);

    expect(first).toBe("processed");
    expect(second).toBe("duplicate");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("does not claim or process an invalid Shopify signature", async () => {
    const rawPayload = JSON.stringify({
      id: 123,
      email: "customer@example.com",
    });

    const store = new MemoryStore();
    const claim = vi.spyOn(store, "claim");
    const handler = vi.fn(async () => {});

    expect(() =>
      parseShopifyWebhook(rawPayload, sign(rawPayload, "wrong-secret"), {
        secret,
        topic: "orders/create",
        webhookId: "webhook-invalid",
      }),
    ).toThrow(WebhookSignatureError);

    expect(claim).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });
});
