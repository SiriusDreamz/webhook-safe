import { createClient } from "redis";
import { handleWebhook, RedisStore } from "../src/index.js";

const client = createClient({
  url: process.env.REDIS_URL ?? "redis://localhost:6379",
});

client.on("error", (error) => {
  console.error("Redis error:", error);
});

await client.connect();

const store = new RedisStore(client);

const event = {
  id: "event_123",
  type: "payment.created",
  payload: {
    amount: 1000,
  },
};

const result = await handleWebhook(event, {
  store,
  getKey: (event) => event.id,
  handler: async (event) => {
    console.log("Processing event:", event);
  },
});

console.log(result);

await client.quit();
