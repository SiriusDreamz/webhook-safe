import { describe, expect, it } from "vitest";
import type { IdempotencyStore } from "../idempotency.js";
import { MemoryStore } from "./memory.js";

const LEASE_MS = 60_000;

function testStore(createStore: () => IdempotencyStore) {
  describe("IdempotencyStore", () => {
    it("returns null for an unknown event", async () => {
      const store = createStore();

      expect(await store.get("event_123")).toBeNull();
    });

    it("claims an event once", async () => {
      const store = createStore();

      const firstClaim = await store.claim("event_123", LEASE_MS);
      const secondClaim = await store.claim("event_123", LEASE_MS);

      expect(firstClaim).not.toBeNull();
      expect(secondClaim).toBeNull();
    });

    it("marks an event as completed", async () => {
      const store = createStore();

      const claim = await store.claim("event_123", LEASE_MS);

      expect(claim).not.toBeNull();

      await store.setCompleted("event_123", claim!);

      expect(await store.get("event_123")).toBe("completed");
    });

    it("releases an event", async () => {
      const store = createStore();

      const claim = await store.claim("event_123", LEASE_MS);

      expect(claim).not.toBeNull();

      await store.release("event_123", claim!);

      expect(await store.get("event_123")).toBeNull();
    });

    it("rejects an invalid lease", async () => {
      const store = createStore();

      await expect(store.claim("event_invalid", 0)).rejects.toThrow(
        "leaseMs must be a finite number greater than 0"
      );
    });
  });
}

testStore(() => new MemoryStore());
