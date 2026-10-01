import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type RedisClientType } from "redis";

import { RedisStore } from "./redis.js";

const redisUrl = process.env.REDIS_URL;

const describeWithRedis = redisUrl ? describe : describe.skip;

describeWithRedis("RedisStore integration", () => {
  let client: RedisClientType;
  let store: RedisStore;

  const prefix = `webhook-safe:test:${process.pid}:${Date.now()}:`;

  beforeAll(async () => {
    client = createClient({
      url: redisUrl,
    });

    await client.connect();

    store = new RedisStore(client, prefix, 60_000);
  });

  afterAll(async () => {
    if (!client) {
      return;
    }

    const keys = await client.keys(`${prefix}*`);

    if (keys.length > 0) {
      await client.del(keys);
    }

    await client.quit();
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

    await store.setCompleted("event_complete", {
      token: "not-the-owner",
    });

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
});
