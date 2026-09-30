import { randomUUID } from "node:crypto";

export function createClaimToken(): string {
  return randomUUID();
}
