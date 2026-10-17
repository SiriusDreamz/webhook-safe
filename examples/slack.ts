import { parseSlackWebhook, type SlackEventCallback } from "../src/index.js";

// Call from your HTTP adapter after enforcing a body limit and requiring exactly
// one X-Slack-Signature and X-Slack-Request-Timestamp header. Preserve raw bytes.
export async function acceptSlackEventsRequest(input: {
  rawBody: Buffer;
  signature: string;
  timestamp: string;
  signingSecret: string;
  enqueue: (key: string, event: SlackEventCallback) => Promise<void>;
}): Promise<{ status: 200; body: { challenge: string } | { accepted: true } }> {
  const event = parseSlackWebhook(input.rawBody, input.signature, {
    secret: input.signingSecret, timestamp: input.timestamp,
  });
  if (event.type === "url_verification") {
    return { status: 200, body: { challenge: event.challenge } };
  }
  // enqueue must durably accept/deduplicate this key before resolving. A durable
  // consumer does business work later; do not replace this with a detached task.
  const key = JSON.stringify(["slack", event.apiAppId, event.teamId, event.eventId]);
  await input.enqueue(key, event);
  return { status: 200, body: { accepted: true } };
}

// Map invalid signatures/payloads to fixed HTTP errors in your adapter. If the
// queue fails, return a non-2xx response so Slack can retry. Respond within Slack's
// three-second deadline. Never log bodies, challenges, tokens or signing secrets.
