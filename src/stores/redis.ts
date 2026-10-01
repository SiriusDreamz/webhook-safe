import type { RedisClientType } from "redis";
import { createClaimToken } from "../claim.js";
import { validateCompletedTtlMs, validateLeaseMs } from "../lease.js";
import type {
  EventStatus,
  IdempotencyClaim,
  IdempotencyStore,
} from "../idempotency.js";

const DEFAULT_COMPLETED_TTL_MS = 24 * 60 * 60 * 1000;

const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

const RENEW_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
return 0
`;

const COMPLETE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("SET", KEYS[1], "completed", "PX", ARGV[2])
end
return 0
`;

export class RedisStore implements IdempotencyStore {
  constructor(
    private readonly client: RedisClientType,
    private readonly prefix = "webhook-safe:",
    private readonly completedTtlMs = DEFAULT_COMPLETED_TTL_MS,
  ) {
    validateCompletedTtlMs(this.completedTtlMs);
  }

  async get(key: string): Promise<EventStatus | null> {
    const value = await this.client.get(this.key(key));

    if (value === "completed") {
      return "completed";
    }

    if (value !== null) {
      return "processing";
    }

    return null;
  }

  async claim(key: string, leaseMs: number): Promise<IdempotencyClaim | null> {
    validateLeaseMs(leaseMs);

    const claim: IdempotencyClaim = {
      token: createClaimToken(),
    };

    const result = await this.client.set(this.key(key), claim.token, {
      NX: true,
      PX: leaseMs,
    });

    return result === "OK" ? claim : null;
  }

  async renew(
    key: string,
    claim: IdempotencyClaim,
    leaseMs: number,
  ): Promise<boolean> {
    validateLeaseMs(leaseMs);

    const result = await this.client.eval(RENEW_SCRIPT, {
      keys: [this.key(key)],
      arguments: [claim.token, String(leaseMs)],
    });

    return result === 1;
  }

  async release(key: string, claim: IdempotencyClaim): Promise<void> {
    await this.client.eval(RELEASE_SCRIPT, {
      keys: [this.key(key)],
      arguments: [claim.token],
    });
  }

  async setCompleted(key: string, claim: IdempotencyClaim): Promise<void> {
    await this.client.eval(COMPLETE_SCRIPT, {
      keys: [this.key(key)],
      arguments: [claim.token, String(this.completedTtlMs)],
    });
  }

  private key(key: string): string {
    return `${this.prefix}${key}`;
  }
}
