import { verifySlackSignature, type SlackSignatureOptions } from "./slack.js";

export interface SlackUrlVerification {
  type: "url_verification";
  challenge: string;
}

export interface SlackEventCallback<T = Record<string, unknown>> {
  type: "event_callback";
  eventId: string;
  teamId: string;
  apiAppId: string;
  event: T;
}

export type SlackWebhookEvent<T = Record<string, unknown>> = SlackUrlVerification | SlackEventCallback<T>;
export type ParseSlackWebhookOptions = SlackSignatureOptions;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 255 && !/\s/.test(value);
}

export function parseSlackWebhook<T = Record<string, unknown>>(
  payload: string | Buffer,
  signatureHeader: string,
  options: ParseSlackWebhookOptions,
): SlackWebhookEvent<T> {
  verifySlackSignature(payload, signatureHeader, options);
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.isBuffer(payload) ? payload.toString("utf8") : payload); }
  catch { throw new Error("Invalid Slack Events API payload"); }
  if (!object(parsed)) throw new Error("Invalid Slack Events API payload");
  if (parsed.type === "url_verification") {
    if (typeof parsed.challenge !== "string" || parsed.challenge.length === 0 || parsed.challenge.length > 4096) {
      throw new Error("Invalid Slack URL verification challenge");
    }
    return { type: "url_verification", challenge: parsed.challenge };
  }
  if (parsed.type !== "event_callback" || !identifier(parsed.event_id) || !identifier(parsed.team_id)
      || !identifier(parsed.api_app_id) || !object(parsed.event) || !identifier(parsed.event.type)) {
    throw new Error("Invalid or unsupported Slack Events API envelope");
  }
  return { type: "event_callback", eventId: parsed.event_id, teamId: parsed.team_id,
    apiAppId: parsed.api_app_id, event: parsed.event as T };
}
