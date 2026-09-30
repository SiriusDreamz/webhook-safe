import { describe, expect, it } from "vitest";
import { handleWebhook, MemoryStore } from "./index.js";

describe("public API", () => {
  it("exports the webhook handler and memory store", async () => {
    const store = new MemoryStore();
    let handled = false;

    const result = await handleWebhook(
      { id: "event_123" },
      {
        store,
        getKey: (event) => event.id,
        handler: async () => {
          handled = true;
        },
      }
    );

    expect(result).toBe("processed");
    expect(handled).toBe(true);
  });
});
