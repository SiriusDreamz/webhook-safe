import { describe, expect, it, vi } from "vitest";
import { handleWebhook } from "./handler.js";
import { MemoryStore } from "./stores/memory.js";

describe("handleWebhook", () => {
  it("processes a new event", async () => {
    const store = new MemoryStore();
    const handler = vi.fn();

    const result = await handleWebhook(
      { id: "event_123" },
      {
        store,
        getKey: (event) => event.id,
        handler,
      }
    );

    expect(result).toBe("processed");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not process the same event twice", async () => {
    const store = new MemoryStore();
    const handler = vi.fn();

    const event = { id: "event_123" };

    const firstResult = await handleWebhook(event, {
      store,
      getKey: (event) => event.id,
      handler,
    });

    const secondResult = await handleWebhook(event, {
      store,
      getKey: (event) => event.id,
      handler,
    });

    expect(firstResult).toBe("processed");
    expect(secondResult).toBe("duplicate");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("allows a failed handler to be retried", async () => {
    const store = new MemoryStore();
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(undefined);

    const event = { id: "event_123" };

    await expect(
      handleWebhook(event, {
        store,
        getKey: (event) => event.id,
        handler,
      })
    ).rejects.toThrow("temporary failure");

    const result = await handleWebhook(event, {
      store,
      getKey: (event) => event.id,
      handler,
    });

    expect(result).toBe("processed");
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("passes the event to the handler", async () => {
    const store = new MemoryStore();
    const handler = vi.fn();

    const event = {
      id: "event_123",
      type: "payment.created",
    };

    await handleWebhook(event, {
      store,
      getKey: (event) => event.id,
      handler,
    });

    expect(handler).toHaveBeenCalledWith(event);
  });

  it("uses the configured idempotency key", async () => {
    const store = new MemoryStore();
    const handler = vi.fn();

    const firstEvent = {
      id: "event_123",
      requestId: "request_1",
    };

    const secondEvent = {
      id: "event_456",
      requestId: "request_1",
    };

    const getKey = (event: typeof firstEvent) => event.requestId;

    const firstResult = await handleWebhook(firstEvent, {
      store,
      getKey,
      handler,
    });

    const secondResult = await handleWebhook(secondEvent, {
      store,
      getKey,
      handler,
    });

    expect(firstResult).toBe("processed");
    expect(secondResult).toBe("duplicate");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid lease", async () => {
    const store = new MemoryStore();
    const handler = vi.fn();

    await expect(
      handleWebhook(
        { id: "event_123" },
        {
          store,
          getKey: (event) => event.id,
          handler,
          leaseMs: 0,
        }
      )
    ).rejects.toThrow(RangeError);

    expect(handler).not.toHaveBeenCalled();
  });

  it("allows an abandoned event to be retried after the lease expires", async () => {
    const store = new MemoryStore();
    const handler = vi.fn();

    const event = { id: "event_123" };

    const firstClaim = await store.claim(event.id, 10);

    expect(firstClaim).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 20));

    const result = await handleWebhook(event, {
      store,
      getKey: (event) => event.id,
      handler,
      leaseMs: 10,
    });

    expect(result).toBe("processed");
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
