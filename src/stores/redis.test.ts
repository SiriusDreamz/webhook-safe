import { describe, expect, it, vi } from "vitest";
import { RedisStore } from "./redis.js";

const LEASE_MS = 60_000;

function createMockClient() {
  return {
    get: vi.fn(),
    set: vi.fn(),
    eval: vi.fn(),
  };
}

describe("RedisStore", () => {
  it("returns null for an unknown event", async () => {
    const client = createMockClient();
    client.get.mockResolvedValue(null);

    const store = new RedisStore(client as any);

    expect(await store.get("event_123")).toBeNull();
    expect(client.get).toHaveBeenCalledWith("webhook-safe:event_123");
  });

  it("returns completed for a completed event", async () => {
    const client = createMockClient();
    client.get.mockResolvedValue("completed");

    const store = new RedisStore(client as any);

    expect(await store.get("event_123")).toBe("completed");
  });

  it("returns processing for an active claim", async () => {
    const client = createMockClient();
    client.get.mockResolvedValue("claim_123");

    const store = new RedisStore(client as any);

    expect(await store.get("event_123")).toBe("processing");
  });

  it("claims an event atomically", async () => {
    const client = createMockClient();
    client.set.mockResolvedValue("OK");

    const store = new RedisStore(client as any);

    const claim = await store.claim("event_123", LEASE_MS);

    expect(claim).not.toBeNull();
    expect(claim?.token).toEqual(expect.any(String));

    expect(client.set).toHaveBeenCalledWith(
      "webhook-safe:event_123",
      expect.any(String),
      {
        NX: true,
        PX: LEASE_MS,
      },
    );
  });

  it("returns null when an event is already claimed", async () => {
    const client = createMockClient();
    client.set.mockResolvedValue(null);

    const store = new RedisStore(client as any);

    const claim = await store.claim("event_123", LEASE_MS);

    expect(claim).toBeNull();
  });

  it("releases an event", async () => {
    const client = createMockClient();
    client.eval.mockResolvedValue(1);

    const store = new RedisStore(client as any);
    const claim = { token: "claim_123" };

    await store.release("event_123", claim);

    expect(client.eval).toHaveBeenCalled();
  });

  it("marks an event as completed", async () => {
    const client = createMockClient();
    client.eval.mockResolvedValue(1);

    const store = new RedisStore(client as any);
    const claim = { token: "claim_123" };

    await store.setCompleted("event_123", claim);

    expect(client.eval).toHaveBeenCalled();
  });

  it("sets the processing lease", async () => {
    const client = createMockClient();
    client.set.mockResolvedValue("OK");

    const store = new RedisStore(client as any);

    await store.claim("event_123", 30_000);

    expect(client.set).toHaveBeenCalledWith(
      "webhook-safe:event_123",
      expect.any(String),
      {
        NX: true,
        PX: 30_000,
      },
    );
  });

  it("rejects an invalid lease", async () => {
    const client = createMockClient();

    const store = new RedisStore(client as any);

    await expect(store.claim("event_123", 0)).rejects.toThrow(RangeError);

    expect(client.set).not.toHaveBeenCalled();
  });

  it("returns a unique claim token", async () => {
    const client = createMockClient();
    client.set.mockResolvedValue("OK");

    const store = new RedisStore(client as any);

    const firstClaim = await store.claim("event_123", LEASE_MS);
    const secondClaim = await store.claim("event_456", LEASE_MS);

    expect(firstClaim).not.toBeNull();
    expect(secondClaim).not.toBeNull();
    expect(firstClaim?.token).not.toBe(secondClaim?.token);
  });

  it("renews a processing lease", async () => {
    const client = createMockClient();
    client.eval.mockResolvedValue(1);

    const store = new RedisStore(client as any);
    const claim = { token: "claim_123" };

    const renewed = await store.renew("event_123", claim, 30_000);

    expect(renewed).toBe(true);

    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("PEXPIRE", KEYS[1], ARGV[2])'),
      {
        keys: ["webhook-safe:event_123"],
        arguments: ["claim_123", "30000"],
      },
    );
  });

  it("returns false when a processing lease is not owned by the claim", async () => {
    const client = createMockClient();
    client.eval.mockResolvedValue(0);

    const store = new RedisStore(client as any);
    const claim = { token: "old_claim" };

    const renewed = await store.renew("event_123", claim, LEASE_MS);

    expect(renewed).toBe(false);
  });

  it("rejects an invalid renewal lease", async () => {
    const client = createMockClient();

    const store = new RedisStore(client as any);
    const claim = { token: "claim_123" };

    await expect(store.renew("event_123", claim, 0)).rejects.toThrow(
      RangeError,
    );

    expect(client.eval).not.toHaveBeenCalled();
  });

  it("releases using an atomic ownership check", async () => {
    const client = createMockClient();
    client.eval.mockResolvedValue(1);

    const store = new RedisStore(client as any);
    const claim = { token: "claim_123" };

    await store.release("event_123", claim);

    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("GET", KEYS[1]) == ARGV[1]'),
      {
        keys: ["webhook-safe:event_123"],
        arguments: ["claim_123"],
      },
    );
  });

  it("completes using an atomic ownership check", async () => {
    const client = createMockClient();
    client.eval.mockResolvedValue(1);

    const store = new RedisStore(client as any);
    const claim = { token: "claim_123" };

    await store.setCompleted("event_123", claim);

    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("GET", KEYS[1]) == ARGV[1]'),
      {
        keys: ["webhook-safe:event_123"],
        arguments: ["claim_123", "86400000"],
      },
    );
  });
});

describe("completed TTL validation", () => {
  it("rejects zero completed TTL", () => {
    const client = createMockClient();

    expect(() => new RedisStore(client as any, "webhook-safe:", 0)).toThrow(
      "completedTtlMs must be a finite number greater than 0",
    );
  });

  it("rejects negative completed TTL", () => {
    const client = createMockClient();

    expect(() => new RedisStore(client as any, "webhook-safe:", -1)).toThrow(
      "completedTtlMs must be a finite number greater than 0",
    );
  });

  it("rejects non-finite completed TTL", () => {
    const client = createMockClient();

    expect(
      () => new RedisStore(client as any, "webhook-safe:", Infinity),
    ).toThrow("completedTtlMs must be a finite number greater than 0");
  });
});
