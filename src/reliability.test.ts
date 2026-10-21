import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleWebhook } from "./handler.js";
import { MemoryStore } from "./stores/memory.js";
import { verifyHmacSignature } from "./signature.js";
import { verifyGitHubSignature } from "./github.js";
import { verifyShopifySignature } from "./shopify.js";
import { verifyStripeSignature } from "./stripe.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
afterEach(() => vi.useRealTimers());

describe("processing failure boundaries", () => {
  it("releases an immediate throw so the delivery can retry immediately", async () => {
    const store = new MemoryStore();
    const failure = new Error("handler failure");
    await expect(handleWebhook("event", {
      store, getKey: value => value, handler: () => { throw failure; },
    })).rejects.toBe(failure);
    expect(await store.get("event")).toBeNull();
    await expect(handleWebhook("event", {
      store, getKey: value => value, handler: async () => {},
    })).resolves.toBe("processed");
  });

  it.each([true, false])("waits for in-flight renewal before finalizing (renewed=%s)", async renewed => {
    vi.useFakeTimers();
    const store = new MemoryStore();
    const work = deferred<void>();
    const renewal = deferred<boolean>();
    vi.spyOn(store, "renew").mockReturnValue(renewal.promise);
    const complete = vi.spyOn(store, "setCompleted");
    const release = vi.spyOn(store, "release");
    const outcome = handleWebhook("event", { store, getKey: value => value,
      handler: () => work.promise, leaseMs: 90 }).then(value => value, error => error);
    await vi.advanceTimersByTimeAsync(30);
    work.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(complete).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    renewal.resolve(renewed);
    const result = await outcome;
    if (renewed) {
      expect(result).toBe("processed");
      expect(complete).toHaveBeenCalledOnce();
    } else {
      expect(result).toEqual(new Error("Webhook processing lease was lost"));
      expect(complete).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledOnce();
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("drains renewal before releasing a failed handler and leaves no heartbeat", async () => {
    vi.useFakeTimers();
    const store = new MemoryStore();
    const work = deferred<void>();
    const renewal = deferred<boolean>();
    vi.spyOn(store, "renew").mockReturnValue(renewal.promise);
    const release = vi.spyOn(store, "release");
    const failure = new Error("handler failure");
    const outcome = handleWebhook("event", { store, getKey: value => value,
      handler: () => work.promise, leaseMs: 90 }).catch(error => error);
    await vi.advanceTimersByTimeAsync(30);
    work.reject(failure);
    await vi.advanceTimersByTimeAsync(0);
    expect(release).not.toHaveBeenCalled();
    renewal.resolve(true);
    expect(await outcome).toBe(failure);
    expect(release).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves the processing error and failed release in an AggregateError", async () => {
    const store = new MemoryStore();
    const failure = new Error("handler failure");
    const cleanup = new Error("store unavailable");
    vi.spyOn(store, "release").mockRejectedValue(cleanup);
    const result = await handleWebhook("event", { store, getKey: value => value,
      handler: () => { throw failure; } }).catch(error => error);
    expect(result).toBeInstanceOf(AggregateError);
    expect(result.errors).toEqual([failure, cleanup]);
    expect(result.cause).toBe(failure);
  });

  it("never completes a late handler after lost ownership", async () => {
    vi.useFakeTimers();
    const store = new MemoryStore();
    const work = deferred<void>();
    vi.spyOn(store, "renew").mockResolvedValue(false);
    const complete = vi.spyOn(store, "setCompleted");
    const outcome = handleWebhook("event", { store, getKey: value => value,
      handler: () => work.promise, leaseMs: 90 }).catch(error => error);
    await vi.advanceTimersByTimeAsync(30);
    expect(await outcome).toEqual(new Error("Webhook processing lease was lost"));
    const newClaim = await store.claim("event", 90);
    work.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(complete).not.toHaveBeenCalled();
    expect(newClaim).not.toBeNull();
    expect(await store.get("event")).toBe("processing");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("signature byte and parsing boundaries", () => {
  const secret = "fixture-secret";
  const timestamp = 1_700_000_000;
  const bytes = Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]);
  const digest = (body: string | Buffer) => createHmac("sha256", secret).update(body).digest("hex");
  const stripeDigest = (body: string | Buffer, t = String(timestamp)) =>
    createHmac("sha256", secret).update(`${t}.`).update(body).digest("hex");

  it("generic and GitHub verification preserve bytes that UTF-8 decoding would replace", () => {
    const signature = digest(bytes);
    expect(() => verifyHmacSignature(bytes, signature, secret)).not.toThrow();
    expect(() => verifyGitHubSignature(bytes, `sha256=${signature}`, { secret })).not.toThrow();
    const reencoded = Buffer.from(bytes.toString("utf8"));
    expect(() => verifyHmacSignature(reencoded, signature, secret)).toThrow();
    expect(() => verifyGitHubSignature(reencoded, `sha256=${signature}`, { secret })).toThrow();
  });

  it("Stripe verifies original Buffer bytes and rejects changed bytes", () => {
    const signature = stripeDigest(bytes);
    expect(verifyStripeSignature(bytes, `t=${timestamp},v1=${signature}`, { secret, now: timestamp * 1000 })).toBe(true);
    expect(verifyStripeSignature(Buffer.from(bytes.toString("utf8")), `t=${timestamp},v1=${signature}`, { secret, now: timestamp * 1000 })).toBe(false);
  });

  it("rejects extra hex nibbles and extra equals without losing multiple-v1 support", () => {
    const signature = stripeDigest(bytes);
    for (const value of [signature + "a", signature + "=extra", signature.slice(1)]) {
      expect(verifyStripeSignature(bytes, `t=${timestamp},v1=${value}`, { secret, now: timestamp * 1000 })).toBe(false);
    }
    expect(verifyStripeSignature(bytes, `t=${timestamp},v1=invalid,v1=${signature}`, { secret, now: timestamp * 1000 })).toBe(true);
  });

  it.each(["1.7e9", "+1700000000", "01700000000", "1700000000.0", "1700000000=extra", "9007199254740992"])("rejects noncanonical timestamp %s", value => {
    expect(verifyStripeSignature(bytes, `t=${value},v1=${stripeDigest(bytes, value)}`, { secret, now: timestamp * 1000 })).toBe(false);
  });

  it("rejects duplicate timestamps and enforces both sides of the exact tolerance boundary", () => {
    const signature = stripeDigest(bytes);
    const header = `t=${timestamp},v1=${signature}`;
    expect(verifyStripeSignature(bytes, header + `,t=${timestamp}`, { secret, now: timestamp * 1000 })).toBe(false);
    for (const direction of [-1, 1]) {
      expect(verifyStripeSignature(bytes, header, { secret, now: timestamp * 1000 + direction * 300_000 })).toBe(true);
      expect(verifyStripeSignature(bytes, header, { secret, now: timestamp * 1000 + direction * 300_001 })).toBe(false);
    }
  });

  it.each([NaN, Infinity, -Infinity, -1])("rejects invalid Stripe clock %s even with a malformed header", now => {
    expect(() => verifyStripeSignature(bytes, "invalid", { secret, now })).toThrow("now must be a finite non-negative timestamp");
  });

  it("rejects an empty Stripe secret", () => {
    expect(() => verifyStripeSignature(bytes, "invalid", { secret: "", now: timestamp * 1000 })).toThrow("Stripe signing secret is required");
  });

  it("rejects decorated or noncanonical Shopify Base64 while preserving bytes", () => {
    const signature = createHmac("sha256", secret).update(bytes).digest("base64");
    expect(() => verifyShopifySignature(bytes, signature, { secret })).not.toThrow();
    for (const value of [signature + "!", signature + "=", signature.slice(0, -1), " " + signature]) {
      expect(() => verifyShopifySignature(bytes, value, { secret })).toThrow();
    }
  });
});
