import { describe, expect, it } from "vitest";
import { isWebhookEvent } from "./validation.js";

describe("isWebhookEvent", () => {
  it("accepts a valid webhook event", () => {
    expect(
      isWebhookEvent({
        id: "event_123",
        type: "payment.created",
        payload: { amount: 1000 },
      })
    ).toBe(true);
  });

  it("rejects an event without an id", () => {
    expect(
      isWebhookEvent({
        type: "payment.created",
        payload: {},
      })
    ).toBe(false);
  });

  it("rejects an event without a type", () => {
    expect(
      isWebhookEvent({
        id: "event_123",
        payload: {},
      })
    ).toBe(false);
  });

  it("rejects non-object values", () => {
    expect(isWebhookEvent(null)).toBe(false);
    expect(isWebhookEvent("event")).toBe(false);
    expect(isWebhookEvent(123)).toBe(false);
  });
});
