import type { WebhookEvent } from "./types.js";

export function isWebhookEvent(value: unknown): value is WebhookEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const event = value as Record<string, unknown>;

  return (
    typeof event.id === "string" &&
    typeof event.type === "string" &&
    "payload" in event
  );
}
