import type { Pool, PoolClient } from "pg";

import { createClaimToken } from "../claim.js";
import { validateCompletedTtlMs, validateLeaseMs } from "../lease.js";
import type {
  EventStatus,
  IdempotencyClaim,
  IdempotencyStore,
} from "../idempotency.js";

const DEFAULT_COMPLETED_TTL_MS = 24 * 60 * 60 * 1000;

export const POSTGRES_STORE_SCHEMA = `
CREATE TABLE IF NOT EXISTS webhook_safe_events (
  key TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('processing', 'completed')
  ),
  expires_at TIMESTAMPTZ NOT NULL
);
`;

type PostgresClient = Pick<Pool | PoolClient, "query">;

interface PostgresEventRow {
  status: EventStatus;
}

export class PostgresStore implements IdempotencyStore {
  constructor(
    private readonly client: PostgresClient,
    private readonly completedTtlMs = DEFAULT_COMPLETED_TTL_MS,
  ) {
    validateCompletedTtlMs(this.completedTtlMs);
  }

  async get(key: string): Promise<EventStatus | null> {
    const result = await this.client.query<PostgresEventRow>(
      `
        SELECT status
        FROM webhook_safe_events
        WHERE key = $1
          AND expires_at > NOW()
        `,
      [key],
    );

    return result.rows[0]?.status ?? null;
  }

  async claim(key: string, leaseMs: number): Promise<IdempotencyClaim | null> {
    validateLeaseMs(leaseMs);

    const claim: IdempotencyClaim = {
      token: createClaimToken(),
    };

    const result = await this.client.query(
      `
      INSERT INTO webhook_safe_events (
        key,
        token,
        status,
        expires_at
      )
      VALUES (
        $1,
        $2,
        'processing',
        NOW() + ($3 * INTERVAL '1 millisecond')
      )
      ON CONFLICT (key) DO UPDATE
      SET
        token = EXCLUDED.token,
        status = 'processing',
        expires_at = EXCLUDED.expires_at
      WHERE webhook_safe_events.expires_at <= NOW()
      RETURNING key
      `,
      [key, claim.token, leaseMs],
    );

    return result.rowCount === 1 ? claim : null;
  }

  async renew(
    key: string,
    claim: IdempotencyClaim,
    leaseMs: number,
  ): Promise<boolean> {
    validateLeaseMs(leaseMs);

    const result = await this.client.query(
      `
      UPDATE webhook_safe_events
      SET expires_at =
        NOW() + ($3 * INTERVAL '1 millisecond')
      WHERE key = $1
        AND token = $2
        AND status = 'processing'
        AND expires_at > NOW()
      `,
      [key, claim.token, leaseMs],
    );

    return result.rowCount === 1;
  }

  async release(key: string, claim: IdempotencyClaim): Promise<void> {
    await this.client.query(
      `
      DELETE FROM webhook_safe_events
      WHERE key = $1
        AND token = $2
        AND status = 'processing'
      `,
      [key, claim.token],
    );
  }

  async setCompleted(key: string, claim: IdempotencyClaim): Promise<void> {
    await this.client.query(
      `
      UPDATE webhook_safe_events
      SET
        status = 'completed',
        token = 'completed',
        expires_at =
          NOW() + ($3 * INTERVAL '1 millisecond')
      WHERE key = $1
        AND token = $2
        AND status = 'processing'
        AND expires_at > NOW()
      `,
      [key, claim.token, this.completedTtlMs],
    );
  }
}
