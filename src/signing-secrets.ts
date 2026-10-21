export interface SigningSecretRotationOptions {
  /** Up to two previous secrets, removed by the application after its overlap window. */
  previousSecrets?: readonly string[];
}

export function signingSecrets(
  secret: string,
  options: SigningSecretRotationOptions,
): readonly string[] {
  if (options.previousSecrets === undefined) return [secret];
  const previous = options.previousSecrets;
  if (!Array.isArray(previous) || previous.length > 2 ||
      typeof secret !== "string" || secret.length === 0) {
    throw new Error("Invalid signing secret rotation configuration");
  }
  const secrets = [secret];
  for (const value of previous) {
    if (typeof value !== "string" || value.length === 0 || secrets.includes(value)) {
      throw new Error("Invalid signing secret rotation configuration");
    }
    secrets.push(value);
  }
  return secrets;
}
