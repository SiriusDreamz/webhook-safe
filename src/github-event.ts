import { verifyGitHubSignature } from "./github.js";

export interface GitHubWebhookEvent<T = unknown> {
  deliveryId: string;
  event: string;
  payload: T;
}

export interface ParseGitHubWebhookOptions {
  secret: string;
  event: string;
  deliveryId: string;
}

export function parseGitHubWebhook<T = unknown>(
  payload: string | Buffer,
  signatureHeader: string,
  options: ParseGitHubWebhookOptions,
): GitHubWebhookEvent<T> {
  verifyGitHubSignature(payload, signatureHeader, {
    secret: options.secret,
  });

  if (typeof options.event !== "string" || options.event.trim().length === 0) {
    throw new Error("GitHub webhook event header is required");
  }

  if (
    typeof options.deliveryId !== "string" ||
    options.deliveryId.trim().length === 0
  ) {
    throw new Error("GitHub webhook delivery ID is required");
  }

  const payloadString = Buffer.isBuffer(payload)
    ? payload.toString("utf8")
    : payload;

  let parsed: unknown;

  try {
    parsed = JSON.parse(payloadString);
  } catch {
    throw new Error("Invalid GitHub webhook payload");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Invalid GitHub webhook payload");
  }

  return {
    deliveryId: options.deliveryId,
    event: options.event,
    payload: parsed as T,
  };
}
