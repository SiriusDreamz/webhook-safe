import { describe, expect, it } from "vitest";
import { handleWebhook, MemoryStore, verifyHmacSignature } from "./index.js";

describe("package smoke test", () => {
  it("exposes the core public API", async () => {
    const store = new MemoryStore();

    const result = await handleWebhook(
      {
        id: "event_123",
        type: "payment.created",
        payload: {},
      },
      {
        store,
        getKey: (event) => event.id,
        handler: async () => {},
      }
    );

    expect(result).toBe("processed");

    expect(() => verifyHmacSignature("payload", "invalid", "secret")).toThrow();
  });
});
