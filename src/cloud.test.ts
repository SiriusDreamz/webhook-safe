import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verifyCloudSignature, type CloudSignatureOptions } from "./index.js";
import { WebhookSignatureError } from "./errors.js";

const vector = JSON.parse(readFileSync(new URL("./cloud-signature-vector.json", import.meta.url), "utf8"));
const body = Buffer.from(vector.payloadBase64, "base64");
const options: CloudSignatureOptions = { secret: vector.secret, deliveryId: vector.deliveryId,
  timestamp: vector.timestamp, now: Number(vector.timestamp) * 1000 };

describe("Cloud delivery verification", () => {
  it("verifies the shared binary vector without parsing or changing bytes", () => {
    expect(() => verifyCloudSignature(body, vector.signature, options)).not.toThrow();
    expect(() => verifyCloudSignature(Buffer.from(body.toString("utf8")), vector.signature, options)).toThrow(WebhookSignatureError);
  });
  it("accepts overlap from either signer and configured previous verifier keys", () => {
    const combined = `${vector.signature},${vector.previousSignature}`;
    for (const secret of [vector.secret, vector.previousSecret])
      expect(() => verifyCloudSignature(body, combined, { ...options, secret })).not.toThrow();
    expect(() => verifyCloudSignature(body, vector.previousSignature, { ...options, previousSecrets: [vector.previousSecret] })).not.toThrow();
    expect(() => verifyCloudSignature(body, vector.previousSignature, options)).toThrow(WebhookSignatureError);
  });
  it("binds payload, identity, timestamp and signing key", () => {
    for (const changed of [Buffer.from("altered"), Buffer.concat([body, Buffer.from(" ")])])
      expect(() => verifyCloudSignature(changed, vector.signature, options)).toThrow(WebhookSignatureError);
    for (const changed of [{ deliveryId: "22222222-2222-4222-8222-222222222222" },
      { timestamp: String(Number(vector.timestamp) + 1) }, { secret: "other-secret-00000000000000000000000000" }])
      expect(() => verifyCloudSignature(body, vector.signature, { ...options, ...changed })).toThrow(WebhookSignatureError);
  });
  it.each([-1, 1])("checks both sides of the exact replay tolerance (%s)", direction => {
    expect(() => verifyCloudSignature(body, vector.signature, { ...options, now: options.now! + direction * 300_000 })).not.toThrow();
    expect(() => verifyCloudSignature(body, vector.signature, { ...options, now: options.now! + direction * 300_001 })).toThrow(WebhookSignatureError);
  });
  it.each(["", "01", "+1795000000", "1e9", "1795000000.0", "1795000000\n", "9007199254740992"])("rejects malformed timestamp %s", timestamp => {
    expect(() => verifyCloudSignature(body, vector.signature, { ...options, timestamp })).toThrow(WebhookSignatureError);
  });
  it.each(["", "event\nother", "x".repeat(1000), vector.deliveryId.toUpperCase()])("rejects malformed identity %s", deliveryId => {
    // The fixture ID contains only digits; explicitly exercise uppercase hex.
    if (deliveryId === vector.deliveryId) deliveryId = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
    expect(() => verifyCloudSignature(body, vector.signature, { ...options, deliveryId })).toThrow(WebhookSignatureError);
  });
  it.each(["", "v2=" + "a".repeat(64), "v1=invalid", vector.signature + "a", vector.signature + "=extra",
    vector.signature + ",t=123", Array(4).fill(vector.signature).join(","), vector.signature.toUpperCase()])("rejects malformed signatures", header => {
    expect(() => verifyCloudSignature(body, header, options)).toThrow(WebhookSignatureError);
  });
  it.each([NaN, Infinity, -1])("rejects invalid clocks %s", now => {
    expect(() => verifyCloudSignature(body, vector.signature, { ...options, now })).toThrow("Cloud now");
  });
  it.each([NaN, Infinity, -1, 301])("rejects invalid tolerances %s", toleranceSeconds => {
    expect(() => verifyCloudSignature(body, vector.signature, { ...options, toleranceSeconds })).toThrow("Cloud toleranceSeconds");
  });
  it("rejects weak, oversized, malformed and duplicate key configuration", () => {
    for (const secret of ["", "short", "x".repeat(4097), "x".repeat(32) + "\ud800"])
      expect(() => verifyCloudSignature(body, vector.signature, { ...options, secret })).toThrow();
    for (const previousSecrets of [[vector.secret], ["short"], Array(3).fill(vector.previousSecret)])
      expect(() => verifyCloudSignature(body, vector.signature, { ...options, previousSecrets })).toThrow();
  });
  it("does not make a valid signed event new: callers must deduplicate by deliveryId", () => {
    for (let i = 0; i < 2; i++) expect(() => verifyCloudSignature(body, vector.signature, options)).not.toThrow();
    const payload = "{\"ok\":true}";
    const signature = "v1=" + createHmac("sha256", vector.secret)
      .update(`v1\n${vector.timestamp}\n${vector.deliveryId}\n`).update(payload).digest("hex");
    expect(() => verifyCloudSignature(payload, signature, options)).not.toThrow();
  });
});
