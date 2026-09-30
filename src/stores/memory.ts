import { createClaimToken } from "../claim.js";
import type {
  EventStatus,
  IdempotencyClaim,
  IdempotencyStore,
} from "../idempotency.js";
import { validateLeaseMs } from "../lease.js";

interface MemoryEvent {
  status: EventStatus;
  expiresAt: number | null;
  claimToken: string | null;
}

export class MemoryStore implements IdempotencyStore {
  private readonly events = new Map<string, MemoryEvent>();

  async get(key: string): Promise<EventStatus | null> {
    const event = this.events.get(key);

    if (!event) {
      return null;
    }

    if (
      event.status === "processing" &&
      event.expiresAt !== null &&
      event.expiresAt <= Date.now()
    ) {
      this.events.delete(key);
      return null;
    }

    return event.status;
  }

  async claim(key: string, leaseMs: number): Promise<IdempotencyClaim | null> {
    validateLeaseMs(leaseMs);

    const existing = this.events.get(key);

    if (existing) {
      if (
        existing.status === "processing" &&
        existing.expiresAt !== null &&
        existing.expiresAt <= Date.now()
      ) {
        this.events.delete(key);
      } else {
        return null;
      }
    }

    const claim: IdempotencyClaim = {
      token: createClaimToken(),
    };

    this.events.set(key, {
      status: "processing",
      expiresAt: Date.now() + leaseMs,
      claimToken: claim.token,
    });

    return claim;
  }

  async release(key: string, claim: IdempotencyClaim): Promise<void> {
    const existing = this.events.get(key);

    if (existing?.claimToken === claim.token) {
      this.events.delete(key);
    }
  }

  async setCompleted(key: string, claim: IdempotencyClaim): Promise<void> {
    const existing = this.events.get(key);

    if (existing?.claimToken !== claim.token) {
      return;
    }

    this.events.set(key, {
      status: "completed",
      expiresAt: null,
      claimToken: null,
    });
  }
}
