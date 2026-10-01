import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { WebhookSignatureError } from "./errors.js";
import { parseShopifyWebhook } from "./shopify-event.js";

function sign(payload: string | Buffer, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64");
}

describe("parseShopifyWebhook", () => {
  const secret = "shopify-webhook-secret";

  const payload = JSON.stringify({
    id: 123,
    email: "customer@example.com",
    total_price: "49.99",
  });

  const options = {
    secret,
    topic: "orders/create",
    webhookId: "webhook-123",
  };

  it("verifies and parses a Shopify webhook", () => {
    const result = parseShopifyWebhook(payload, sign(payload, secret), options);

    expect(result).toEqual({
      webhookId: "webhook-123",
      topic: "orders/create",
      payload: {
        id: 123,
        email: "customer@example.com",
        total_price: "49.99",
      },
    });
  });

  it("accepts a Buffer payload", () => {
    const buffer = Buffer.from(payload);

    const result = parseShopifyWebhook(buffer, sign(buffer, secret), options);

    expect(result.webhookId).toBe("webhook-123");
    expect(result.topic).toBe("orders/create");
  });

  it("supports a typed payload", () => {
    interface OrderPayload {
      id: number;
      email: string;
      total_price: string;
    }

    const result = parseShopifyWebhook<OrderPayload>(
      payload,
      sign(payload, secret),
      options,
    );

    expect(result.payload.id).toBe(123);
    expect(result.payload.email).toBe("customer@example.com");
  });

  it("rejects an invalid signature", () => {
    expect(() =>
      parseShopifyWebhook(payload, sign(payload, "wrong-secret"), options),
    ).toThrow(WebhookSignatureError);
  });

  it("rejects malformed JSON", () => {
    const malformed = "{invalid-json";

    expect(() =>
      parseShopifyWebhook(malformed, sign(malformed, secret), options),
    ).toThrow("Invalid Shopify webhook payload");
  });

  it("rejects a missing topic", () => {
    expect(() =>
      parseShopifyWebhook(payload, sign(payload, secret), {
        ...options,
        topic: "",
      }),
    ).toThrow("Shopify webhook topic is required");
  });

  it("rejects a missing webhook ID", () => {
    expect(() =>
      parseShopifyWebhook(payload, sign(payload, secret), {
        ...options,
        webhookId: "",
      }),
    ).toThrow("Shopify webhook ID is required");
  });

  it("rejects a non-object JSON payload", () => {
    const primitive = JSON.stringify("invalid");

    expect(() =>
      parseShopifyWebhook(primitive, sign(primitive, secret), options),
    ).toThrow("Invalid Shopify webhook payload");
  });

  it("rejects an array JSON payload", () => {
    const array = JSON.stringify([]);

    expect(() =>
      parseShopifyWebhook(array, sign(array, secret), options),
    ).toThrow("Invalid Shopify webhook payload");
  });
});
