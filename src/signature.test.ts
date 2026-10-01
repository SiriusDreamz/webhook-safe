import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyHmacSignature } from "./signature.js";
import { WebhookSignatureError } from "./errors.js";

describe("verifyHmacSignature", () => {
  const payload = '{"id":"event_123"}';
  const secret = "test_secret";

  it("accepts a valid signature", () => {
    const signature = createHmac("sha256", secret)
      .update(payload)
      .digest("hex");

    expect(() => {
      verifyHmacSignature(payload, signature, secret);
    }).not.toThrow();
  });

  it("accepts a sha256-prefixed signature", () => {
    const signature = createHmac("sha256", secret)
      .update(payload)
      .digest("hex");

    expect(() => {
      verifyHmacSignature(payload, `sha256=${signature}`, secret);
    }).not.toThrow();
  });

  it("rejects an invalid signature", () => {
    expect(() => {
      verifyHmacSignature(payload, "invalid_signature", secret);
    }).toThrow(WebhookSignatureError);
  });

  it("rejects the wrong secret", () => {
    const signature = createHmac("sha256", secret)
      .update(payload)
      .digest("hex");

    expect(() => {
      verifyHmacSignature(payload, signature, "wrong_secret");
    }).toThrow(WebhookSignatureError);
  });

  it("rejects a modified payload", () => {
    const signature = createHmac("sha256", secret)
      .update(payload)
      .digest("hex");

    expect(() => {
      verifyHmacSignature('{"id":"event_456"}', signature, secret);
    }).toThrow(WebhookSignatureError);
  });
});
