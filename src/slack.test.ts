import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySlackSignature, WebhookSignatureError } from "./index.js";

const timestamp = "1700000000", secret = "isolated-slack-signing-secret";
const options = { secret, timestamp, now: Number(timestamp) * 1000 };
const sign = (body: string | Buffer, time = timestamp) => `v0=${createHmac("sha256", secret).update(`v0:${time}:`).update(body).digest("hex")}`;

describe("Slack signatures", () => {
  it("matches Slack's documented reference vector", () => {
    const body = "token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c";
    expect(() => verifySlackSignature(body, "v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503", {
      secret: "8f742231b10e8888abcd99yyyzzz85a5", timestamp: "1531420618", now: 1531420618000,
    })).not.toThrow();
  });

  it("verifies exact bytes, including non-UTF8 Buffer data, without normalization", () => {
    for (const body of ["", "{\"text\":\"你好 🌍\"}\n", "payload=%7B%22action%22%3A%22run%22%7D", Buffer.from([0xff, 0xfe, 0, 13, 10])]) {
      expect(() => verifySlackSignature(body, sign(body), options)).not.toThrow();
      const tampered = Buffer.concat([Buffer.from(body), Buffer.from(" ")]);
      expect(() => verifySlackSignature(tampered, sign(body), options)).toThrow(WebhookSignatureError);
    }
    expect(() => verifySlackSignature("body", sign("body"), { ...options, secret: "wrong" })).toThrow(WebhookSignatureError);
  });

  it("enforces both timestamp boundaries and permits a stricter tolerance", () => {
    const signature = sign("body");
    for (const offset of [-300000, 300000]) expect(() => verifySlackSignature("body", signature, { ...options, now: options.now + offset })).not.toThrow();
    for (const offset of [-300001, 300001]) expect(() => verifySlackSignature("body", signature, { ...options, now: options.now + offset })).toThrow(WebhookSignatureError);
    expect(() => verifySlackSignature("body", signature, { ...options, now: options.now + 1001, toleranceSeconds: 1 })).toThrow(WebhookSignatureError);
  });

  it("rejects malformed, duplicate/combined and version-mismatched headers", () => {
    for (const time of ["", " 1700000000", "1700000000 ", "1700000000,1700000000", "1e9", "1700000000.0", "01700000000", "-1", "9007199254740992"]) {
      expect(() => verifySlackSignature("body", sign("body", time), { ...options, timestamp: time })).toThrow(WebhookSignatureError);
    }
    for (const signature of ["", "v1=" + "a".repeat(64), "v0=" + "a".repeat(63), "v0=" + "g".repeat(64), sign("body") + "," + sign("body"), " " + sign("body"), sign("body").toUpperCase()]) {
      expect(() => verifySlackSignature("body", signature, options)).toThrow(WebhookSignatureError);
    }
  });

  it("fails closed on invalid secret, clock or tolerance configuration", () => {
    for (const toleranceSeconds of [-1, 301, NaN, Infinity]) expect(() => verifySlackSignature("body", sign("body"), { ...options, toleranceSeconds })).toThrow();
    for (const now of [-1, NaN, Infinity]) expect(() => verifySlackSignature("body", sign("body"), { ...options, now })).toThrow();
    expect(() => verifySlackSignature("body", sign("body"), { ...options, secret: "" })).toThrow();
  });
});
