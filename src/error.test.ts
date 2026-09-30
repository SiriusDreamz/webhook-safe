import { describe, expect, it } from "vitest";
import { WebhookError, WebhookSignatureError } from "./errors.js";

describe("webhook errors", () => {
  it("creates a WebhookError", () => {
    const error = new WebhookError("Something went wrong");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(WebhookError);
    expect(error.name).toBe("WebhookError");
    expect(error.message).toBe("Something went wrong");
  });

  it("creates a WebhookSignatureError", () => {
    const error = new WebhookSignatureError();

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(WebhookError);
    expect(error).toBeInstanceOf(WebhookSignatureError);
    expect(error.name).toBe("WebhookSignatureError");
    expect(error.message).toBe("Invalid webhook signature");
  });
});
