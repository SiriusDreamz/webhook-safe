import { verifyHmacSignature } from "./signature.js";
import type { SigningSecretRotationOptions } from "./signing-secrets.js";

export interface GitHubSignatureOptions extends SigningSecretRotationOptions {
  secret: string;
}

export function verifyGitHubSignature(
  payload: string | Buffer,
  signatureHeader: string,
  options: GitHubSignatureOptions,
): void {
  if (!signatureHeader.startsWith("sha256=")) {
    throw new Error("GitHub webhook signature must use sha256");
  }

  verifyHmacSignature(payload, signatureHeader, options.secret, options);
}
