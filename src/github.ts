import { verifyHmacSignature } from "./signature.js";

export interface GitHubSignatureOptions {
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

  verifyHmacSignature(payload, signatureHeader, options.secret);
}
