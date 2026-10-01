import { describe, expect, it } from "vitest";
import { handleWebhook, MemoryStore, type WebhookEvent } from "./index.js";

describe("webhook-safe integration", () => {
  it("processes a webhook once and ignores a duplicate", async () => {
    const store = new MemoryStore();
    const processed: string[] = [];

    const event: WebhookEvent = {
      id: "evt_123",
      type: "payment.completed",
      payload: {
        amount: 4200,
      },
    };

    const options = {
      store,
      getKey: (value: WebhookEvent) => value.id,
      handler: async (value: WebhookEvent) => {
        processed.push(value.id);
      },
    };

    await expect(handleWebhook(event, options)).resolves.toBe("processed");
    await expect(handleWebhook(event, options)).resolves.toBe("duplicate");

    expect(processed).toEqual(["evt_123"]);
  });

  it("retries after a handler failure", async () => {
    const store = new MemoryStore();
    let attempts = 0;

    const event: WebhookEvent = {
      id: "evt_retry",
      type: "payment.completed",
      payload: {
        amount: 4200,
      },
    };

    const options = {
      store,
      getKey: (value: WebhookEvent) => value.id,
      handler: async () => {
        attempts += 1;

        if (attempts === 1) {
          throw new Error("temporary failure");
        }
      },
    };

    await expect(handleWebhook(event, options)).rejects.toThrow(
      "temporary failure",
    );

    await expect(handleWebhook(event, options)).resolves.toBe("processed");

    expect(attempts).toBe(2);
  });
});
