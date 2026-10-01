import { describe, expect, it } from "vitest";
import { MemoryStore } from "./stores/memory.js";

const LEASE_MS = 60_000;

describe("MemoryStore", () => {
  it("returns null for an unknown event", async () => {
    const store = new MemoryStore();

    expect(await store.get("event_123")).toBeNull();
  });

  it("claims an event successfully", async () => {
    const store = new MemoryStore();

    const claim = await store.claim("event_123", LEASE_MS);

    expect(claim).not.toBeNull();
    expect(claim?.token).toEqual(expect.any(String));
    expect(await store.get("event_123")).toBe("processing");
  });

  it("does not allow an event to be claimed twice", async () => {
    const store = new MemoryStore();

    const firstClaim = await store.claim("event_123", LEASE_MS);
    const secondClaim = await store.claim("event_123", LEASE_MS);

    expect(firstClaim).not.toBeNull();
    expect(secondClaim).toBeNull();
  });

  it("marks an event as completed", async () => {
    const store = new MemoryStore();

    const claim = await store.claim("event_123", LEASE_MS);

    expect(claim).not.toBeNull();

    await store.setCompleted("event_123", claim!);

    expect(await store.get("event_123")).toBe("completed");
  });

  it("keeps different events separate", async () => {
    const store = new MemoryStore();

    const firstClaim = await store.claim("event_123", LEASE_MS);
    const secondClaim = await store.claim("event_456", LEASE_MS);

    expect(firstClaim).not.toBeNull();
    expect(secondClaim).not.toBeNull();
  });

  it("only allows one caller to claim an event", async () => {
    const store = new MemoryStore();

    const claims = await Promise.all(
      Array.from({ length: 10 }, () => store.claim("event_123", LEASE_MS)),
    );

    expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
  });

  it("allows a processing claim to be retried after the lease expires", async () => {
    const store = new MemoryStore();

    const firstClaim = await store.claim("event_123", 10);

    expect(firstClaim).not.toBeNull();
    expect(await store.claim("event_123", 10)).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 20));

    const secondClaim = await store.claim("event_123", 10);

    expect(secondClaim).not.toBeNull();
    expect(secondClaim?.token).not.toBe(firstClaim?.token);
  });

  it("does not allow an old claim to release a newer claim", async () => {
    const store = new MemoryStore();

    const firstClaim = await store.claim("event_123", 10);

    expect(firstClaim).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 20));

    const secondClaim = await store.claim("event_123", 60_000);

    expect(secondClaim).not.toBeNull();

    await store.release("event_123", firstClaim!);

    expect(await store.get("event_123")).toBe("processing");
  });

  it("renews a processing lease owned by the claim", async () => {
    const store = new MemoryStore();

    const claim = await store.claim("event_123", 100);

    expect(claim).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(await store.renew("event_123", claim!, 100)).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(await store.get("event_123")).toBe("processing");
  });

  it("does not renew a lease owned by another claim", async () => {
    const store = new MemoryStore();

    const firstClaim = await store.claim("event_123", 10);

    expect(firstClaim).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 20));

    const secondClaim = await store.claim("event_123", LEASE_MS);

    expect(secondClaim).not.toBeNull();

    expect(await store.renew("event_123", firstClaim!, LEASE_MS)).toBe(false);
  });

  it("does not renew an expired lease", async () => {
    const store = new MemoryStore();

    const claim = await store.claim("event_123", 10);

    expect(claim).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(await store.renew("event_123", claim!, LEASE_MS)).toBe(false);
  });

  it("does not allow an old claim to complete a newer claim", async () => {
    const store = new MemoryStore();

    const firstClaim = await store.claim("event_123", 10);

    expect(firstClaim).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 20));

    const secondClaim = await store.claim("event_123", 60_000);

    expect(secondClaim).not.toBeNull();

    await store.setCompleted("event_123", firstClaim!);

    expect(await store.get("event_123")).toBe("processing");
  });
});
