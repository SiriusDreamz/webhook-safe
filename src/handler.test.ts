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
      },
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
      }),
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
        },
      ),
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

  it("only processes concurrent deliveries once", async () => {
    const store = new MemoryStore();

    let resolveHandler!: () => void;

    const handlerStarted = new Promise<void>((resolve) => {
      resolveHandler = resolve;
    });

    const handler = vi.fn(async () => {
      await handlerStarted;
    });

    const event = { id: "event_123" };

    const first = handleWebhook(event, {
      store,
      getKey: (event) => event.id,
      handler,
    });

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });

    const second = await handleWebhook(event, {
      store,
      getKey: (event) => event.id,
      handler,
    });

    expect(second).toBe("duplicate");
    expect(handler).toHaveBeenCalledTimes(1);

    resolveHandler();

    const firstResult = await first;

    expect(firstResult).toBe("processed");
  });

  it("releases the claim when the handler fails", async () => {
    const store = new MemoryStore();

    const firstHandler = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"));

    const firstEvent = { id: "event_123" };

    await expect(
      handleWebhook(firstEvent, {
        store,
        getKey: (event) => event.id,
        handler: firstHandler,
      }),
    ).rejects.toThrow("temporary failure");

    const secondHandler = vi.fn();

    const result = await handleWebhook(firstEvent, {
      store,
      getKey: (event) => event.id,
      handler: secondHandler,
    });

    expect(result).toBe("processed");
    expect(secondHandler).toHaveBeenCalledTimes(1);
  });

  it("does not allow an expired worker to complete a newer claim", async () => {
    const store = new MemoryStore();

    const firstClaim = await store.claim("event_123", 10);

    expect(firstClaim).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 20));

    const secondClaim = await store.claim("event_123", 60_000);

    expect(secondClaim).not.toBeNull();
    expect(secondClaim?.token).not.toBe(firstClaim?.token);

    await store.setCompleted("event_123", firstClaim!);

    expect(await store.get("event_123")).toBe("processing");

    await store.setCompleted("event_123", secondClaim!);

    expect(await store.get("event_123")).toBe("completed");
  });
});
