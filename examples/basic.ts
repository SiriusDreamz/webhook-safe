import {
  handleWebhook,
  MemoryStore,
  verifyHmacSignature,
} from "../src/index.js";

const store = new MemoryStore();

const payload = JSON.stringify({
  id: "event_123",
  type: "payment.created",
  payload: {
    amount: 1000,
  },
});

const signature = "your-hmac-signature";
const secret = "your-webhook-secret";

// Throws WebhookSignatureError if the signature is invalid.
verifyHmacSignature(payload, signature, secret);

const event = JSON.parse(payload);

const result = await handleWebhook(event, {
  store,
  getKey: (event) => event.id,
  handler: async (event) => {
    console.log("Processing event:", event);
  },
});

console.log(result);
