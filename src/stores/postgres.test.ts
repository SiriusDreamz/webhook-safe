import { describe, expect, it, vi } from "vitest";

import { POSTGRES_STORE_SCHEMA, PostgresStore } from "./postgres.js";

const LEASE_MS = 60_000;

function createMockClient() {
  return {
    query: vi.fn(),
  };
}

describe("PostgresStore", () => {
  it("provides the required table schema", () => {
    expect(POSTGRES_STORE_SCHEMA).toContain(
      "CREATE TABLE IF NOT EXISTS webhook_safe_events",
    );

    expect(POSTGRES_STORE_SCHEMA).toContain("key TEXT PRIMARY KEY");

    expect(POSTGRES_STORE_SCHEMA).toContain("expires_at TIMESTAMPTZ NOT NULL");
  });

  it("returns null for an unknown event", async () => {
    const client = createMockClient();

    client.query.mockResolvedValue({
      rows: [],
      rowCount: 0,
    });

    const store = new PostgresStore(client as any);

    expect(await store.get("event_123")).toBeNull();

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("expires_at > NOW()"),
      ["event_123"],
    );
  });

  it("returns completed for a completed event", async () => {
    const client = createMockClient();

    client.query.mockResolvedValue({
      rows: [{ status: "completed" }],
      rowCount: 1,
    });

    const store = new PostgresStore(client as any);

    expect(await store.get("event_123")).toBe("completed");
  });

  it("returns processing for an active claim", async () => {
    const client = createMockClient();

    client.query.mockResolvedValue({
      rows: [{ status: "processing" }],
      rowCount: 1,
    });

    const store = new PostgresStore(client as any);

    expect(await store.get("event_123")).toBe("processing");
  });

  it("claims an event atomically", async () => {
    const client = createMockClient();

    client.query.mockResolvedValue({
      rows: [{ key: "event_123" }],
      rowCount: 1,
    });

    const store = new PostgresStore(client as any);

    const claim = await store.claim("event_123", LEASE_MS);

    expect(claim).not.toBeNull();

    expect(claim?.token).toEqual(expect.any(String));

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (key) DO UPDATE"),
      ["event_123", expect.any(String), LEASE_MS],
    );
  });

  it("reclaims only an expired event", async () => {
    const client = createMockClient();

    client.query.mockResolvedValue({
      rows: [{ key: "event_123" }],
      rowCount: 1,
    });

    const store = new PostgresStore(client as any);

    await store.claim("event_123", LEASE_MS);

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("webhook_safe_events.expires_at <= NOW()"),
      ["event_123", expect.any(String), LEASE_MS],
    );
  });

  it("returns null when an event cannot be claimed", async () => {
    const client = createMockClient();

    client.query.mockResolvedValue({
      rows: [],
      rowCount: 0,
    });

    const store = new PostgresStore(client as any);

    const claim = await store.claim("event_123", LEASE_MS);

    expect(claim).toBeNull();
  });

  it("rejects an invalid lease", async () => {
    const client = createMockClient();

    const store = new PostgresStore(client as any);

    await expect(store.claim("event_123", 0)).rejects.toThrow(RangeError);

    expect(client.query).not.toHaveBeenCalled();
  });

  it("returns a unique claim token", async () => {
    const client = createMockClient();

    client.query.mockResolvedValue({
      rows: [{ key: "event" }],
      rowCount: 1,
    });

    const store = new PostgresStore(client as any);

    const firstClaim = await store.claim("event_123", LEASE_MS);

    const secondClaim = await store.claim("event_456", LEASE_MS);

    expect(firstClaim).not.toBeNull();
    expect(secondClaim).not.toBeNull();

    expect(firstClaim?.token).not.toBe(secondClaim?.token);
  });

  it("renews a processing lease", async () => {
    const client = createMockClient();

    client.query.mockResolvedValue({
      rows: [],
      rowCount: 1,
    });

    const store = new PostgresStore(client as any);

    const renewed = await store.renew(
      "event_123",
      { token: "claim_123" },
      30_000,
    );

    expect(renewed).toBe(true);

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("AND token = $2"),
      ["event_123", "claim_123", 30_000],
    );

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("AND expires_at > NOW()"),
      ["event_123", "claim_123", 30_000],
    );
  });

  it("returns false when the claim does not own the lease", async () => {
    const client = createMockClient();

    client.query.mockResolvedValue({
      rows: [],
      rowCount: 0,
    });

    const store = new PostgresStore(client as any);

    const renewed = await store.renew(
      "event_123",
      { token: "old_claim" },
      LEASE_MS,
    );

    expect(renewed).toBe(false);
  });

  it("rejects an invalid renewal lease", async () => {
    const client = createMockClient();

    const store = new PostgresStore(client as any);

    await expect(
      store.renew("event_123", { token: "claim_123" }, 0),
    ).rejects.toThrow(RangeError);

    expect(client.query).not.toHaveBeenCalled();
  });

  it("releases using an atomic ownership check", async () => {
    const client = createMockClient();

    client.query.mockResolvedValue({
      rows: [],
      rowCount: 1,
    });

    const store = new PostgresStore(client as any);

    await store.release("event_123", { token: "claim_123" });

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("AND token = $2"),
      ["event_123", "claim_123"],
    );

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("AND status = 'processing'"),
      ["event_123", "claim_123"],
    );
  });

  it("marks an owned active claim as completed", async () => {
    const client = createMockClient();

    client.query.mockResolvedValue({
      rows: [],
      rowCount: 1,
    });

    const store = new PostgresStore(client as any, 86_400_000);

    await store.setCompleted("event_123", { token: "claim_123" });

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'completed'"),
      ["event_123", "claim_123", 86_400_000],
    );

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("token = 'completed'"),
      ["event_123", "claim_123", 86_400_000],
    );

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("AND token = $2"),
      ["event_123", "claim_123", 86_400_000],
    );

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("AND expires_at > NOW()"),
      ["event_123", "claim_123", 86_400_000],
    );
  });
});

describe("PostgresStore completed TTL validation", () => {
  it("rejects zero completed TTL", () => {
    const client = createMockClient();

    expect(() => new PostgresStore(client as any, 0)).toThrow(
      "completedTtlMs must be a finite number greater than 0",
    );
  });

  it("rejects negative completed TTL", () => {
    const client = createMockClient();

    expect(() => new PostgresStore(client as any, -1)).toThrow(
      "completedTtlMs must be a finite number greater than 0",
    );
  });

  it("rejects non-finite completed TTL", () => {
    const client = createMockClient();

    expect(() => new PostgresStore(client as any, Infinity)).toThrow(
      "completedTtlMs must be a finite number greater than 0",
    );
  });
});
