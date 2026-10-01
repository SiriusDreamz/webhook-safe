import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { WebhookSignatureError } from "./errors.js";
import { verifyGitHubSignature } from "./github.js";

function sign(payload: string | Buffer, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

describe("verifyGitHubSignature", () => {
  const secret = "github-webhook-secret";
  const payload = JSON.stringify({
    action: "opened",
    repository: {
      id: 123,
      full_name: "example/repository",
    },
  });

  it("accepts a valid GitHub signature", () => {
    expect(() =>
      verifyGitHubSignature(payload, sign(payload, secret), { secret }),
    ).not.toThrow();
  });

  it("accepts a Buffer payload", () => {
    const buffer = Buffer.from(payload);

    expect(() =>
      verifyGitHubSignature(buffer, sign(buffer, secret), { secret }),
    ).not.toThrow();
  });

  it("rejects a signature created with the wrong secret", () => {
    expect(() =>
      verifyGitHubSignature(payload, sign(payload, "wrong-secret"), { secret }),
    ).toThrow(WebhookSignatureError);
  });

  it("rejects a signature for a modified payload", () => {
    const signature = sign(payload, secret);

    expect(() =>
      verifyGitHubSignature(`${payload} `, signature, { secret }),
    ).toThrow(WebhookSignatureError);
  });

  it("rejects a signature without the sha256 prefix", () => {
    const signature = sign(payload, secret).replace("sha256=", "");

    expect(() => verifyGitHubSignature(payload, signature, { secret })).toThrow(
      "GitHub webhook signature must use sha256",
    );
  });

  it("rejects a malformed signature", () => {
    expect(() =>
      verifyGitHubSignature(payload, "sha256=not-hex", { secret }),
    ).toThrow(WebhookSignatureError);
  });
});
