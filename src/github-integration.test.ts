import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { WebhookSignatureError } from "./errors.js";
import { parseGitHubWebhook } from "./github-event.js";
import { handleWebhook } from "./handler.js";
import { MemoryStore } from "./stores/memory.js";

function sign(payload: string | Buffer, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

describe("GitHub webhook integration", () => {
  const secret = "github-webhook-secret";

  it("processes a signed GitHub delivery only once", async () => {
    const rawPayload = JSON.stringify({
      action: "opened",
      repository: {
        id: 123,
        full_name: "example/repository",
      },
      pull_request: {
        id: 456,
        number: 42,
      },
    });

    const event = parseGitHubWebhook(rawPayload, sign(rawPayload, secret), {
      secret,
      event: "pull_request",
      deliveryId: "delivery-123",
    });

    const store = new MemoryStore();
    const handler = vi.fn(async () => {});

    const options = {
      store,
      getKey: (webhook: typeof event) => webhook.deliveryId,
      handler,
    };

    const first = await handleWebhook(event, options);

    const second = await handleWebhook(event, options);

    expect(first).toBe("processed");
    expect(second).toBe("duplicate");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("does not claim or process an invalid GitHub signature", async () => {
    const rawPayload = JSON.stringify({
      action: "opened",
      repository: {
        id: 123,
        full_name: "example/repository",
      },
    });

    const store = new MemoryStore();
    const claim = vi.spyOn(store, "claim");
    const handler = vi.fn(async () => {});

    expect(() =>
      parseGitHubWebhook(rawPayload, sign(rawPayload, "wrong-secret"), {
        secret,
        event: "pull_request",
        deliveryId: "delivery-invalid",
      }),
    ).toThrow(WebhookSignatureError);

    expect(claim).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });
});
