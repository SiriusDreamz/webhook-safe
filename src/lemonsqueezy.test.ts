import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyLemonSqueezySignature, WebhookSignatureError } from "./index.js";

const secret = "signing-secret";
const previous = "previous-signing-secret";
const payload = '{"meta":{"event_name":"order_created"},"data":{"id":"1"}}';

function signature(body: string | Buffer, key = secret): string {
  return createHmac("sha256", key).update(body).digest("hex");
}

describe("verifyLemonSqueezySignature", () => {
  it("accepts the documented hex HMAC of the raw body", () => {
    expect(() =>
      verifyLemonSqueezySignature(payload, signature(payload), { secret }),
    ).not.toThrow();
    const bytes = Buffer.from(payload);
    expect(() =>
      verifyLemonSqueezySignature(bytes, signature(bytes), { secret }),
    ).not.toThrow();
  });

  it("accepts a previous signing secret only while it remains configured", () => {
    const header = signature(payload, previous);
    expect(() =>
      verifyLemonSqueezySignature(payload, header, { secret, previousSecrets: [previous] }),
    ).not.toThrow();
    expect(() => verifyLemonSqueezySignature(payload, header, { secret })).toThrow(
      WebhookSignatureError,
    );
    expect(() =>
      verifyLemonSqueezySignature(payload, header, { secret, previousSecrets: [] }),
    ).toThrow(WebhookSignatureError);
  });

  it("preserves raw bytes and rejects re-serialized JSON", () => {
    const body = Buffer.from([0xff, 0xfe, 0x00, 0x0a]);
    const header = signature(body);
    expect(() => verifyLemonSqueezySignature(body, header, { secret })).not.toThrow();
    expect(() =>
      verifyLemonSqueezySignature(Buffer.from(body.toString("utf8")), header, { secret }),
    ).toThrow(WebhookSignatureError);
    const spaced = '{ "meta": { "event_name": "order_created" } }\n';
    expect(() =>
      verifyLemonSqueezySignature(JSON.stringify(JSON.parse(spaced)), signature(spaced), {
        secret,
      }),
    ).toThrow(WebhookSignatureError);
  });

  it("rejects a tampered body and the wrong secret", () => {
    expect(() =>
      verifyLemonSqueezySignature(`${payload} `, signature(payload), { secret }),
    ).toThrow(WebhookSignatureError);
    expect(() =>
      verifyLemonSqueezySignature(payload, signature(payload, "other-secret"), { secret }),
    ).toThrow(WebhookSignatureError);
  });

  it("rejects a missing, malformed, or wrong-length signature without throwing RangeError", () => {
    for (const header of [
      "",
      "abc",
      "zz".repeat(32),
      signature(payload).toUpperCase(),
      `sha256=${signature(payload)}`,
      signature(payload).slice(0, 63),
      `${signature(payload)}00`,
    ]) {
      expect(() => verifyLemonSqueezySignature(payload, header, { secret })).toThrow(
        WebhookSignatureError,
      );
    }
  });

  it("rejects an empty secret and invalid rotation configuration", () => {
    expect(() =>
      verifyLemonSqueezySignature(payload, signature(payload), { secret: "" }),
    ).toThrow("Lemon Squeezy signing secret is required");
    expect(() =>
      verifyLemonSqueezySignature(payload, signature(payload), {
        secret,
        previousSecrets: [secret, previous, "third"],
      }),
    ).toThrow("Invalid signing secret rotation configuration");
  });
});
