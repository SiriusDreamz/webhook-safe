import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { verifyShopifySignature } from "./shopify.js";

function sign(payload: string | Buffer, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64");
}

describe("verifyShopifySignature", () => {
  const secret = "shopify-webhook-secret";

  const payload = JSON.stringify({
    id: 123,
    email: "customer@example.com",
    total_price: "49.99",
  });

  it("accepts a valid Shopify signature", () => {
    expect(() =>
      verifyShopifySignature(payload, sign(payload, secret), { secret }),
    ).not.toThrow();
  });

  it("accepts a Buffer payload", () => {
    const buffer = Buffer.from(payload);

    expect(() =>
      verifyShopifySignature(buffer, sign(buffer, secret), { secret }),
    ).not.toThrow();
  });

  it("rejects a signature created with the wrong secret", () => {
    expect(() =>
      verifyShopifySignature(payload, sign(payload, "wrong-secret"), {
        secret,
      }),
    ).toThrow();
  });

  it("rejects a signature for a modified payload", () => {
    const signature = sign(payload, secret);

    expect(() =>
      verifyShopifySignature(`${payload} `, signature, { secret }),
    ).toThrow();
  });

  it("rejects a malformed signature", () => {
    expect(() =>
      verifyShopifySignature(payload, "not-a-valid-signature", { secret }),
    ).toThrow();
  });
});
