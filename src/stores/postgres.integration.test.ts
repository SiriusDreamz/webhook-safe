import { handleWebhook } from "../handler.js";
import { WebhookError } from "../errors.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { POSTGRES_STORE_SCHEMA, PostgresStore } from "./postgres.js";

const postgresUrl = process.env.POSTGRES_URL;

const describeWithPostgres = postgresUrl ? describe : describe.skip;

describeWithPostgres("PostgresStore integration", () => {
  let pool: Pool;
  let store: PostgresStore;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: postgresUrl,
    });

    await pool.query(POSTGRES_STORE_SCHEMA);

    await pool.query("TRUNCATE TABLE webhook_safe_events");

    store = new PostgresStore(pool, 60_000);
  });

  afterAll(async () => {
    if (!pool) {
      return;
    }

    await pool.query("DROP TABLE IF EXISTS webhook_safe_events");

    await pool.end();
  });

  it("atomically allows only one claim owner", async () => {
    const [first, second] = await Promise.all([
      store.claim("event_atomic", 10_000),
      store.claim("event_atomic", 10_000),
    ]);

    const successfulClaims = [first, second].filter((claim) => claim !== null);

    expect(successfulClaims).toHaveLength(1);
  });

  it("renews a lease only for the current owner", async () => {
    const claim = await store.claim("event_renew", 10_000);

    expect(claim).not.toBeNull();

    expect(await store.renew("event_renew", claim!, 20_000)).toBe(true);

    expect(
      await store.renew(
        "event_renew",
        {
          token: "not-the-owner",
        },
        20_000,
      ),
    ).toBe(false);

    expect(await store.get("event_renew")).toBe("processing");
  });

  it("releases an event only for the current owner", async () => {
    const claim = await store.claim("event_release", 10_000);

    expect(claim).not.toBeNull();

    await store.release("event_release", {
      token: "not-the-owner",
    });

    expect(await store.get("event_release")).toBe("processing");

    await store.release("event_release", claim!);

    expect(await store.get("event_release")).toBeNull();
  });

  it("marks an event completed only for the current owner", async () => {
    const claim = await store.claim("event_complete", 10_000);

    expect(claim).not.toBeNull();

    await expect(store.setCompleted("event_complete", {
      token: "not-the-owner",
    })).rejects.toBeInstanceOf(WebhookError);

    expect(await store.get("event_complete")).toBe("processing");

    await store.setCompleted("event_complete", claim!);

    expect(await store.get("event_complete")).toBe("completed");

    expect(await store.claim("event_complete", 10_000)).toBeNull();
  });

  it("allows an abandoned processing lease to be reclaimed", async () => {
    const firstClaim = await store.claim("event_expiry", 50);

    expect(firstClaim).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 100));

    const secondClaim = await store.claim("event_expiry", 10_000);

    expect(secondClaim).not.toBeNull();

    expect(secondClaim!.token).not.toBe(firstClaim!.token);
  });

  it("rejects completion after expiry without a replacement", async () => {
    const key = "event_expired_completion";
    const claim = await store.claim(key, 60_000);
    expect(claim).not.toBeNull();
    await pool.query(
        "UPDATE webhook_safe_events SET expires_at = NOW() - INTERVAL '1 second' WHERE key = $1",
        [key],
      );
    await expect(store.setCompleted(key, claim!)).rejects.toBeInstanceOf(WebhookError);
    expect(await store.get(key)).toBeNull();
  });

  it("rejects repeated completion without changing the completed event", async () => {
    const key = "event_repeated_completion";
    const claim = await store.claim(key, 60_000);
    await store.setCompleted(key, claim!);
    await expect(store.setCompleted(key, claim!)).rejects.toBeInstanceOf(WebhookError);
    expect(await store.get(key)).toBe("completed");
  });

  it("rejects a completion race and preserves the replacement through handler cleanup", async () => {
    const key = "event_completion_takeover";
    let replacement: Awaited<ReturnType<typeof store.claim>> = null;
    const wrapper = {
      get: store.get.bind(store),
      claim: store.claim.bind(store),
      renew: store.renew.bind(store),
      release: store.release.bind(store),
      setCompleted: async (eventKey: string, claim: { token: string }) => {
        await pool.query(
        "UPDATE webhook_safe_events SET expires_at = NOW() - INTERVAL '1 second' WHERE key = $1",
        [key],
      );
        replacement = await store.claim(key, 60_000);
        expect(replacement).not.toBeNull();
        return store.setCompleted(eventKey, claim);
      },
    };
    await expect(handleWebhook(key, {
      store: wrapper, getKey: value => value, handler: async () => {},
    })).rejects.toBeInstanceOf(WebhookError);
    expect(await store.get(key)).toBe("processing");
    // Old completion and handleWebhook's release must not remove the new owner.
    await store.setCompleted(key, replacement!);
    expect(await store.get(key)).toBe("completed");
  });
});
