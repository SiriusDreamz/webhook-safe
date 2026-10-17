import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { handleWebhook, MemoryStore, parseSlackWebhook, WebhookSignatureError } from "./index.js";

const secret = "isolated-slack-secret", timestamp = "1700000000";
const options = { secret, timestamp, now: Number(timestamp) * 1000 };
const sign = (body: string) => `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
const callback = { type: "event_callback", event_id: "Ev1", team_id: "T1", api_app_id: "A1", event: { type: "app_mention", text: "Synthetic fixture" } };
const parse = (value: unknown) => { const body = JSON.stringify(value); return parseSlackWebhook(body, sign(body), options); };

describe("Slack Events API parsing and retries", () => {
  it("returns a signed challenge without the deprecated verification token", () => {
    expect(parse({ type: "url_verification", challenge: "synthetic-challenge", token: "must-not-be-returned" })).toEqual({ type: "url_verification", challenge: "synthetic-challenge" });
  });

  it("validates signature before parsing or returning any challenge", () => {
    for (const body of ["not JSON", JSON.stringify({ type: "url_verification", challenge: "untrusted" })]) {
      expect(() => parseSlackWebhook(body, "v0=" + "0".repeat(64), options)).toThrow(WebhookSignatureError);
    }
    expect(() => parseSlackWebhook("not JSON", sign("not JSON"), options)).toThrow("Invalid Slack Events API payload");
  });

  it("validates the supported envelope without trusting a generic event type assertion", () => {
    for (const value of [null, [], "text", { type: "url_verification", challenge: "" }, { type: "url_verification", challenge: "x".repeat(4097) },
      { ...callback, event_id: "" }, { ...callback, event_id: "Ev 1" }, { ...callback, team_id: null }, { ...callback, api_app_id: "" },
      { ...callback, event: [] }, { ...callback, event: {} }, { ...callback, event: { type: 1 } }, { type: "app_rate_limited" }]) {
      expect(() => parse(value)).toThrow();
    }
    expect(parse(callback)).toEqual({ type: "event_callback", eventId: "Ev1", teamId: "T1", apiAppId: "A1", event: callback.event });
  });

  it("uses the same callback identity across signed retries and releases after handler failure", async () => {
    const first = parse(callback), retry = parse(callback);
    if (first.type !== "event_callback" || retry.type !== "event_callback") throw Error("Unexpected fixture type");
    const store = new MemoryStore(), handler = vi.fn(async () => {});
    const settings = { store, getKey: (event: typeof first) => JSON.stringify(["slack", event.apiAppId, event.teamId, event.eventId]), handler };
    expect(await handleWebhook(first, settings)).toBe("processed");
    expect(await handleWebhook(retry, settings)).toBe("duplicate");
    expect(handler).toHaveBeenCalledTimes(1);
    const other = { ...first, eventId: "Ev2" };
    await expect(handleWebhook(other, { ...settings, handler: async () => { throw Error("synthetic failure"); } })).rejects.toThrow("synthetic failure");
    expect(await handleWebhook(other, settings)).toBe("processed");
    expect(await handleWebhook({ ...first, teamId: "T2" }, settings)).toBe("processed");
    expect(await handleWebhook({ ...first, apiAppId: "A2" }, settings)).toBe("processed");
  });
});
