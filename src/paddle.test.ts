import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyPaddleSignature, WebhookSignatureError } from "./index.js";

const secret = "pdl_ntfset_01gkpjp8bkm3tm53kdgkx6sms7_test_secret";
const previous = "pdl_ntfset_01gkpjp8bkm3tm53kdgkx6sms7_previous_secret";
const timestamp = "1671552777";
const now = Number(timestamp) * 1000;
const payload = '{"event_id":"evt_01","event_type":"transaction.completed"}';

function h1(body: string | Buffer, key = secret, ts = timestamp): string {
  return createHmac("sha256", key).update(`${ts}:`).update(body).digest("hex");
}

function header(body: string | Buffer = payload, key = secret, ts = timestamp): string {
  return `ts=${ts};h1=${h1(body, key, ts)}`;
}

describe("verifyPaddleSignature", () => {
  it("accepts the documented ts and h1 construction for string and Buffer bodies", () => {
    expect(() =>
      verifyPaddleSignature(payload, header(), { secret, now }),
    ).not.toThrow();
    const bytes = Buffer.from(payload);
    expect(() =>
      verifyPaddleSignature(bytes, `ts=${timestamp};h1=${h1(bytes)}`, { secret, now }),
    ).not.toThrow();
  });

  it("accepts any matching h1 when the header carries a rotated signature", () => {
    const rotated = `ts=${timestamp};h1=${h1(payload, previous)};h1=${h1(payload, secret)}`;
    expect(() => verifyPaddleSignature(payload, rotated, { secret, now })).not.toThrow();
    const onlyPrevious = `ts=${timestamp};h1=${"ab".repeat(32)};h1=${h1(payload, previous)}`;
    expect(() =>
      verifyPaddleSignature(payload, onlyPrevious, {
        secret,
        previousSecrets: [previous],
        now,
      }),
    ).not.toThrow();
    expect(() => verifyPaddleSignature(payload, onlyPrevious, { secret, now })).toThrow(
      WebhookSignatureError,
    );
  });

  it("preserves raw bytes and rejects a re-serialized body", () => {
    const body = Buffer.from([0x7b, 0xff, 0x7d]);
    const signature = `ts=${timestamp};h1=${h1(body)}`;
    expect(() => verifyPaddleSignature(body, signature, { secret, now })).not.toThrow();
    expect(() =>
      verifyPaddleSignature(body.toString("utf8"), signature, { secret, now }),
    ).toThrow(WebhookSignatureError);
    const spaced = '{ "event_id": "evt_01" }';
    expect(() =>
      verifyPaddleSignature(JSON.stringify(JSON.parse(spaced)), header(spaced), { secret, now }),
    ).toThrow(WebhookSignatureError);
  });

  it("rejects a tampered body and the wrong secret", () => {
    expect(() =>
      verifyPaddleSignature(`${payload} `, header(), { secret, now }),
    ).toThrow(WebhookSignatureError);
    expect(() =>
      verifyPaddleSignature(payload, header(payload, "other-secret"), { secret, now }),
    ).toThrow(WebhookSignatureError);
  });

  it("enforces the five-second replay window in both directions", () => {
    const signature = header();
    for (const offset of [5_000, -5_000]) {
      expect(() =>
        verifyPaddleSignature(payload, signature, { secret, now: now + offset }),
      ).not.toThrow();
    }
    for (const offset of [5_001, -5_001]) {
      expect(() =>
        verifyPaddleSignature(payload, signature, { secret, now: now + offset }),
      ).toThrow(WebhookSignatureError);
    }
    expect(() =>
      verifyPaddleSignature(payload, signature, {
        secret,
        now: now + 1_001,
        toleranceSeconds: 1,
      }),
    ).toThrow(WebhookSignatureError);
  });

  it("rejects malformed and missing headers", () => {
    const digest = h1(payload);
    for (const value of [
      "",
      `h1=${digest}`,
      `ts=${timestamp}`,
      `ts=${timestamp};h1=${digest.slice(0, 63)}`,
      `ts=${timestamp};h1=${digest.toUpperCase()}`,
      `ts=${timestamp};h1=${digest};h1=abcd`,
      `ts=${timestamp};ts=${timestamp};h1=${digest}`,
      `ts=${timestamp};v1=${digest}`,
      `ts=01671552777;h1=${digest}`,
      `ts=${timestamp}.0;h1=${digest}`,
      `ts=-1;h1=${digest}`,
      `ts=;h1=${digest}`,
      "not-a-signature",
    ]) {
      expect(() => verifyPaddleSignature(payload, value, { secret, now })).toThrow(
        WebhookSignatureError,
      );
    }
  });

  it("rejects invalid secret, tolerance, clock, and rotation configuration", () => {
    expect(() => verifyPaddleSignature(payload, header(), { secret: "", now })).toThrow(
      "Paddle signing secret is required",
    );
    for (const toleranceSeconds of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        verifyPaddleSignature(payload, header(), { secret, now, toleranceSeconds }),
      ).toThrow("Paddle toleranceSeconds must be a finite non-negative number");
    }
    for (const clock of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        verifyPaddleSignature(payload, header(), { secret, now: clock }),
      ).toThrow("Paddle now must be a finite non-negative timestamp");
    }
    expect(() =>
      verifyPaddleSignature(payload, header(), { secret, previousSecrets: [secret], now }),
    ).toThrow("Invalid signing secret rotation configuration");
  });
});
