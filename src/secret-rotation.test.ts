import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  handleWebhook, MemoryStore, parseGitHubWebhook, parseShopifyWebhook,
  parseSlackWebhook, parseStripeWebhook, verifyGitHubSignature,
  verifyHmacSignature, verifyShopifySignature, verifySlackSignature,
  verifyStripeSignature,
} from "./index.js";

const providers = ["generic", "github", "shopify", "stripe", "slack"] as const;
type Provider = typeof providers[number];
const current = "fixture-current-secret";
const previous = "fixture-previous-secret";
const older = "fixture-older-secret";
const timestamp = "1700000000";
const now = Number(timestamp) * 1000;
const bytes = Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]);

function sign(provider: Provider, payload: string | Buffer, secret: string): string {
  const hmac = createHmac("sha256", secret);
  if (provider === "stripe") hmac.update(`${timestamp}.`);
  if (provider === "slack") hmac.update(`v0:${timestamp}:`);
  hmac.update(payload);
  if (provider === "shopify") return hmac.digest("base64");
  const hex = hmac.digest("hex");
  return provider === "stripe" ? `t=${timestamp},v1=${hex}` : provider === "slack" ? `v0=${hex}` : `sha256=${hex}`;
}

function verify(provider: Provider, payload: string | Buffer, signature: string,
  previousSecrets?: readonly string[], clock = now): boolean {
  const options = { secret: current, previousSecrets };
  if (provider === "stripe") return verifyStripeSignature(payload, signature, { ...options, now: clock });
  if (provider === "slack") verifySlackSignature(payload, signature, { ...options, timestamp, now: clock });
  else if (provider === "github") verifyGitHubSignature(payload, signature, options);
  else if (provider === "shopify") verifyShopifySignature(payload, signature, options);
  else verifyHmacSignature(payload, signature, current, options);
  return true;
}

function rejected(provider: Provider, payload: string | Buffer, signature: string,
  previousSecrets?: readonly string[], clock = now) {
  if (provider === "stripe") expect(verify(provider, payload, signature, previousSecrets, clock)).toBe(false);
  else expect(() => verify(provider, payload, signature, previousSecrets, clock)).toThrow();
}

describe.each(providers)("%s secret rotation", provider => {
  it("retains current-key-only behavior when rotation is omitted or empty", () => {
    expect(verify(provider, bytes, sign(provider, bytes, current))).toBe(true);
    expect(verify(provider, bytes, sign(provider, bytes, current), [])).toBe(true);
    rejected(provider, bytes, sign(provider, bytes, previous));
  });

  it("accepts current and both previous keys with exact signed bytes", () => {
    const keys = Object.freeze([previous, older]);
    for (const secret of [current, previous, older]) {
      expect(verify(provider, bytes, sign(provider, bytes, secret), keys)).toBe(true);
    }
    expect(keys).toEqual([previous, older]);
    rejected(provider, bytes, sign(provider, bytes, "unconfigured-key"), keys);
  });

  it("rejects re-encoded bytes and removes old-key acceptance when overlap ends", () => {
    const signature = sign(provider, bytes, previous);
    rejected(provider, Buffer.from(bytes.toString("utf8")), signature, [previous]);
    rejected(provider, bytes, signature, []);
  });

  it.each(([
    [previous, older, "too-many"], [previous, previous], [current], [""],
    [previous, ""], [17], null, "not-an-array", Array(1),
  ] as unknown[]).map(value => ({ value })))("rejects invalid configuration without exposing secrets: $value", ({ value }) => {
    expect(() => verify(provider, bytes, sign(provider, bytes, current),
      value as unknown as readonly string[])).toThrow("Invalid signing secret rotation configuration");
  });
});

describe("rotation does not weaken provider constraints", () => {
  it.each(["stripe", "slack"] as const)("enforces %s replay tolerance for old keys", provider => {
    const signature = sign(provider, bytes, previous);
    for (const direction of [-1, 1]) {
      expect(verify(provider, bytes, signature, [previous], now + direction * 300_000)).toBe(true);
      rejected(provider, bytes, signature, [previous], now + direction * 300_001);
    }
  });

  it("retains multiple Stripe v1 support during overlap", () => {
    const signature = sign("stripe", bytes, previous);
    expect(verify("stripe", bytes, signature + ",v1=invalid", [previous])).toBe(true);
    rejected("stripe", bytes, signature + `,t=${timestamp}`, [previous]);
  });

  it("passes rotation options through all event parsers without changing identities", () => {
    const stripe = JSON.stringify({ id: "evt_rotation", object: "event", type: "test", data: { object: {} } });
    const github = JSON.stringify({ action: "opened" });
    const shopify = JSON.stringify({ id: 123 });
    const slack = JSON.stringify({ type: "event_callback", event_id: "Ev_rotation", team_id: "T1", api_app_id: "A1", event: { type: "app_mention" } });
    const options = { secret: current, previousSecrets: [previous] };
    expect(parseStripeWebhook(stripe, sign("stripe", stripe, previous), { ...options, now }).id).toBe("evt_rotation");
    expect(parseGitHubWebhook(github, sign("github", github, previous), { ...options, event: "pull_request", deliveryId: "delivery_rotation" }).deliveryId).toBe("delivery_rotation");
    expect(parseShopifyWebhook(shopify, sign("shopify", shopify, previous), { ...options, topic: "orders/create", webhookId: "webhook_rotation" }).webhookId).toBe("webhook_rotation");
    expect(parseSlackWebhook(slack, sign("slack", slack, previous), { ...options, timestamp, now })).toMatchObject({ type: "event_callback", eventId: "Ev_rotation" });
    const challenge = JSON.stringify({ type: "url_verification", challenge: "fixture-challenge" });
    expect(parseSlackWebhook(challenge, sign("slack", challenge, previous), { ...options, timestamp, now })).toEqual({ type: "url_verification", challenge: "fixture-challenge" });
  });

  it("deduplicates old-key and new-key deliveries by the same signed event identity", async () => {
    const payload = JSON.stringify({ id: "evt_rotation", object: "event", type: "test", data: { object: {} } });
    const store = new MemoryStore();
    let calls = 0;
    for (const [index, secret] of [previous, current].entries()) {
      const event = parseStripeWebhook(payload, sign("stripe", payload, secret), { secret: current, previousSecrets: [previous], now });
      const result = await handleWebhook(event, { store, getKey: event => event.id, handler: async () => { calls++; } });
      expect(result).toBe(index === 0 ? "processed" : "duplicate");
    }
    expect(calls).toBe(1);
  });
});
