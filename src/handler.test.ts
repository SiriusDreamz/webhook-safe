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
    expect(await store.get("event_123")).toBe("completed");
  });

  it("skips duplicate events", async () => {
    const store = new MemoryStore();
    const handler = vi.fn();

    const options = {
      store,
      getKey: (event: { id: string }) => event.id,
      handler,
    };

    expect(await handleWebhook({ id: "event_123" }, options)).toBe("processed");
    expect(await handleWebhook({ id: "event_123" }, options)).toBe("duplicate");

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("only processes one concurrent delivery", async () => {
    const store = new MemoryStore();

    let resolveHandler!: () => void;

    const handlerFinished = new Promise<void>((resolve) => {
      resolveHandler = resolve;
    });

    const handler = vi.fn(async () => {
      await handlerFinished;
    });

    const options = {
      store,
      getKey: (event: { id: string }) => event.id,
      handler,
    };

    const first = handleWebhook({ id: "event_123" }, options);
    const second = handleWebhook({ id: "event_123" }, options);

    await Promise.resolve();

    resolveHandler();

    const results = await Promise.all([first, second]);

    expect(results.sort()).toEqual(["duplicate", "processed"]);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("allows a failed event to be retried", async () => {
    const store = new MemoryStore();

    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(undefined);

    const options = {
      store,
      getKey: (event: { id: string }) => event.id,
      handler,
    };

    await expect(handleWebhook({ id: "event_123" }, options)).rejects.toThrow(
      "temporary failure"
    );

    expect(await store.get("event_123")).toBeNull();

    expect(await handleWebhook({ id: "event_123" }, options)).toBe("processed");

    expect(handler).toHaveBeenCalledTimes(2);
    expect(await store.get("event_123")).toBe("completed");
  });

  it("allows a failed event to be retried successfully", async () => {
    const store = new MemoryStore();

    let attempts = 0;

    const handler = async () => {
      attempts += 1;

      if (attempts === 1) {
        throw new Error("temporary failure");
      }
    };

    await expect(
      handleWebhook(
        { id: "event_123" },
        {
          store,
          getKey: (event) => event.id,
          handler,
        }
      )
    ).rejects.toThrow("temporary failure");

    const result = await handleWebhook(
      { id: "event_123" },
      {
        store,
        getKey: (event) => event.id,
        handler,
      }
    );

    expect(result).toBe("processed");
    expect(attempts).toBe(2);
  });

  it("rejects an invalid lease", async () => {
    const store = new MemoryStore();

    await expect(
      handleWebhook(
        { id: "event_123" },
        {
          store,
          leaseMs: 0,
          getKey: (event) => event.id,
          handler: async () => {},
        }
      )
    ).rejects.toThrow("leaseMs must be a finite number greater than 0");
  });
});
