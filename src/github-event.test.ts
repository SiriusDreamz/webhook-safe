import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { WebhookSignatureError } from "./errors.js";
import { parseGitHubWebhook } from "./github-event.js";

function sign(payload: string | Buffer, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

describe("parseGitHubWebhook", () => {
  const secret = "github-webhook-secret";

  const payload = JSON.stringify({
    action: "opened",
    repository: {
      id: 123,
      full_name: "example/repository",
    },
  });

  const options = {
    secret,
    event: "pull_request",
    deliveryId: "delivery-123",
  };

  it("verifies and parses a GitHub webhook", () => {
    const result = parseGitHubWebhook(payload, sign(payload, secret), options);

    expect(result).toEqual({
      deliveryId: "delivery-123",
      event: "pull_request",
      payload: {
        action: "opened",
        repository: {
          id: 123,
          full_name: "example/repository",
        },
      },
    });
  });

  it("accepts a Buffer payload", () => {
    const buffer = Buffer.from(payload);

    const result = parseGitHubWebhook(buffer, sign(buffer, secret), options);

    expect(result.deliveryId).toBe("delivery-123");
    expect(result.event).toBe("pull_request");
  });

  it("supports a typed payload", () => {
    interface PullRequestPayload {
      action: string;
      repository: {
        id: number;
        full_name: string;
      };
    }

    const result = parseGitHubWebhook<PullRequestPayload>(
      payload,
      sign(payload, secret),
      options,
    );

    expect(result.payload.action).toBe("opened");
    expect(result.payload.repository.id).toBe(123);
  });

  it("rejects an invalid signature", () => {
    expect(() =>
      parseGitHubWebhook(payload, sign(payload, "wrong-secret"), options),
    ).toThrow(WebhookSignatureError);
  });

  it("rejects malformed JSON", () => {
    const malformed = "{invalid-json";

    expect(() =>
      parseGitHubWebhook(malformed, sign(malformed, secret), options),
    ).toThrow("Invalid GitHub webhook payload");
  });

  it("rejects a missing event header", () => {
    expect(() =>
      parseGitHubWebhook(payload, sign(payload, secret), {
        ...options,
        event: "",
      }),
    ).toThrow("GitHub webhook event header is required");
  });

  it("rejects a missing delivery ID", () => {
    expect(() =>
      parseGitHubWebhook(payload, sign(payload, secret), {
        ...options,
        deliveryId: "",
      }),
    ).toThrow("GitHub webhook delivery ID is required");
  });

  it("rejects a non-object JSON payload", () => {
    const primitive = JSON.stringify("invalid");

    expect(() =>
      parseGitHubWebhook(primitive, sign(primitive, secret), options),
    ).toThrow("Invalid GitHub webhook payload");
  });

  it("rejects an array JSON payload", () => {
    const array = JSON.stringify([]);

    expect(() =>
      parseGitHubWebhook(array, sign(array, secret), options),
    ).toThrow("Invalid GitHub webhook payload");
  });
});
