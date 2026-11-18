import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { receiveCloudDelivery } from "../examples/cloud.js";
import { MemoryStore } from "./index.js";

describe("Cloud receiver example", () => {
  it("authenticates before work, preserves bytes and deduplicates fresh retry signatures by stable identity", async () => {
    const secret = "fixture-cloud-receiver-key-00000000000000000";
    const deliveryId = "11111111-1111-4111-8111-111111111111";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = Buffer.from([0xff, 0x0a]);
    const signature = "v1=" + createHmac("sha256", secret).update(`v1\n${timestamp}\n${deliveryId}\n`).update(body).digest("hex");
    const headers = { deliveryId, timestamp, signature };
    const handler = vi.fn(async (raw: Buffer) => { expect(raw).toEqual(body); });
    const options = { secret, store: new MemoryStore(), handler };
    await expect(receiveCloudDelivery(Buffer.from("altered"), headers, options)).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
    await expect(receiveCloudDelivery(body, headers, options)).resolves.toBe("processed");
    const retryTimestamp = String(Number(timestamp) + 1);
    const retrySignature = "v1=" + createHmac("sha256", secret).update(`v1\n${retryTimestamp}\n${deliveryId}\n`).update(body).digest("hex");
    await expect(receiveCloudDelivery(body, { deliveryId, timestamp: retryTimestamp, signature: retrySignature }, options)).resolves.toBe("duplicate");
    expect(handler).toHaveBeenCalledOnce();
  });
});
