import { afterEach, describe, expect, it, vi } from "vitest";
import { WebhookError } from "./errors.js";
import { handleWebhook } from "./handler.js";
import { MemoryStore } from "./stores/memory.js";
import { PostgresStore } from "./stores/postgres.js";
import { RedisStore } from "./stores/redis.js";

afterEach(() => vi.useRealTimers());

describe("completion acknowledgement", () => {
  it.each(["redis", "postgres"])("rejects %s completion misses rather than reporting processed", async kind => {
    const release = vi.fn();
    const store = kind === "redis"
      ? new RedisStore({ set: async () => "OK", eval: async () => 0 } as any)
      : new PostgresStore({ query: async (sql: string) => ({
        rows: [], rowCount: sql.includes("INSERT INTO") ? 1 : 0,
      }) } as any);
    vi.spyOn(store, "release").mockImplementation(release);
    const handler = vi.fn(async () => {});
    await expect(handleWebhook("event", {
      store, getKey: value => value, handler,
    })).rejects.toBeInstanceOf(WebhookError);
    expect(handler).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("rejects an expired memory claim even if nobody reclaimed it", async () => {
    vi.useFakeTimers();
    const store = new MemoryStore();
    const claim = await store.claim("event", 100);
    vi.setSystemTime(Date.now() + 100);
    await expect(store.setCompleted("event", claim!)).rejects.toBeInstanceOf(WebhookError);
    expect(await store.get("event")).toBeNull();
  });

  it("rejects missing and already completed memory claims", async () => {
    const store = new MemoryStore();
    await expect(store.setCompleted("missing", { token: "missing" })).rejects.toBeInstanceOf(WebhookError);
    const claim = await store.claim("event", 60_000);
    await store.setCompleted("event", claim!);
    await expect(store.setCompleted("event", claim!)).rejects.toBeInstanceOf(WebhookError);
    expect(await store.get("event")).toBe("completed");
  });

  it("preserves a replacement memory claim and stops heartbeats after completion fails", async () => {
    vi.useFakeTimers();
    const store = new MemoryStore();
    let replacement: Awaited<ReturnType<typeof store.claim>> = null;
    const originalComplete = store.setCompleted.bind(store);
    vi.spyOn(store, "setCompleted").mockImplementation(async (key, claim) => {
      vi.setSystemTime(Date.now() + 100);
      replacement = await store.claim(key, 60_000);
      return originalComplete(key, claim);
    });
    await expect(handleWebhook("event", {
      store, leaseMs: 100, getKey: value => value, handler: async () => {},
    })).rejects.toBeInstanceOf(WebhookError);
    expect(replacement).not.toBeNull();
    expect(await store.get("event")).toBe("processing");
    await originalComplete("event", replacement!);
    expect(await store.get("event")).toBe("completed");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves completion and cleanup errors", async () => {
    const store = new MemoryStore();
    const completion = new WebhookError("completion not acknowledged");
    const cleanup = new Error("cleanup unavailable");
    vi.spyOn(store, "setCompleted").mockRejectedValue(completion);
    vi.spyOn(store, "release").mockRejectedValue(cleanup);
    const result = await handleWebhook("event", {
      store, getKey: value => value, handler: async () => {},
    }).catch(error => error);
    expect(result).toBeInstanceOf(AggregateError);
    expect(result.errors).toEqual([completion, cleanup]);
    expect(result.cause).toBe(completion);
  });
});
