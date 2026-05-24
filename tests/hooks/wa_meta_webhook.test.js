import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb } from "./_helper.js";

// Tests for wa_meta_webhook.pb.js non-signature logic:
//   - GET verify-token handshake
//   - POST inbound from unknown phone (no user found) → 200
//   - POST deduplication by wamid → 200 on both (second is silent skip)
//   - POST rate limit: 31st unique message from same phone → 200
//
// The HMAC/signature path is covered by wa_meta_signature.test.js — not repeated here.
// WA_SKIP_SIGNATURE_CHECK=1 bypasses that path so these tests exercise everything after.

const VERIFY_TOKEN = "test_verify_token_abc";
// Bogus phone that will NOT match any seeded user — triggers "no user found" path.
const BOGUS_PHONE = "19999999999";

function makePayload(fromPhone, wamid, bodyText = "where is kit 1") {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1012217101334902",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "+1 555-654-7786",
                phone_number_id: "1059995567204667",
              },
              contacts: [{ profile: { name: "Tester" }, wa_id: fromPhone }],
              messages: [
                {
                  from: fromPhone,
                  id: wamid,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: bodyText },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

async function postWebhook(baseUrl, body) {
  return fetch(`${baseUrl}/api/wa/meta/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

describe("wa_meta_webhook non-signature logic", () => {
  let baseUrl;

  beforeAll(async () => {
    // Set env BEFORE startPb — PB process inherits process.env at boot time.
    process.env.WHATSAPP_VERIFY_TOKEN = VERIFY_TOKEN;
    process.env.WA_SKIP_SIGNATURE_CHECK = "1";
    // Intentionally NOT setting WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_TOKEN:
    // outbound reply path no-ops gracefully ("cannot send outbound"), still returns 200.
    delete process.env.WHATSAPP_APP_SECRET;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_TOKEN;
    const pb = await startPb();
    baseUrl = pb.baseUrl;
  }, 60000);

  afterAll(async () => {
    await stopPb();
    delete process.env.WHATSAPP_VERIFY_TOKEN;
    delete process.env.WA_SKIP_SIGNATURE_CHECK;
  });

  // ---------------------------------------------------------------------------
  // Case 1: GET with correct hub.verify_token echoes hub.challenge (200)
  // ---------------------------------------------------------------------------
  it("GET with correct verify_token echoes hub.challenge (200)", async () => {
    const challenge = "abc123challenge";
    const url = new URL(`${baseUrl}/api/wa/meta/webhook`);
    url.searchParams.set("hub.mode", "subscribe");
    url.searchParams.set("hub.verify_token", VERIFY_TOKEN);
    url.searchParams.set("hub.challenge", challenge);

    const res = await fetch(url.toString());
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe(challenge);
  });

  // ---------------------------------------------------------------------------
  // Case 2: GET with wrong hub.verify_token → 403
  // ---------------------------------------------------------------------------
  it("GET with wrong verify_token returns 403", async () => {
    const url = new URL(`${baseUrl}/api/wa/meta/webhook`);
    url.searchParams.set("hub.mode", "subscribe");
    url.searchParams.set("hub.verify_token", "wrong_token_xyz");
    url.searchParams.set("hub.challenge", "shouldnotecho");

    const res = await fetch(url.toString());
    expect(res.status).toBe(403);
  });

  // ---------------------------------------------------------------------------
  // Case 3: POST from bogus phone (no matching user) → 200
  // Hook path: user lookup returns null → replyViaMeta called with no creds → 200
  // ---------------------------------------------------------------------------
  it("POST from unknown phone returns 200 (no-user path)", async () => {
    const wamid = `wamid.test.nouser.${Date.now()}`;
    const res = await postWebhook(baseUrl, makePayload(BOGUS_PHONE, wamid));
    expect(res.status).toBe(200);
  });

  // ---------------------------------------------------------------------------
  // Case 4: Idempotency — POST same wamid twice, both return 200
  // Second call hits the dedup path (returns c.string(200,"") early).
  // No response body signal distinguishes them — assert status only.
  // ---------------------------------------------------------------------------
  it("POST same wamid twice both return 200 (dedup on second)", async () => {
    const wamid = `wamid.test.dedup.${Date.now()}`;
    const body = makePayload(BOGUS_PHONE, wamid, "list kits");

    const res1 = await postWebhook(baseUrl, body);
    expect(res1.status).toBe(200);

    const res2 = await postWebhook(baseUrl, body);
    expect(res2.status).toBe(200);
  });

  // ---------------------------------------------------------------------------
  // Case 5: Rate limit — 31st unique message from same phone → 200
  // Hook: rateEntry.count > RATE_MAX (30) → c.string(200, "") — confirmed from source.
  // Uses a distinct phone to avoid interference with other cases.
  // ---------------------------------------------------------------------------
  it("POST 31 unique messages from same phone all return 200 (rate limit returns 200)", async () => {
    const ratePhone = "15550000001";
    const RATE_MAX = 30;
    const requests = Array.from({ length: RATE_MAX + 1 }, (_, i) =>
      makePayload(ratePhone, `wamid.test.rate.${Date.now()}.${i}`, `message ${i}`)
    );

    for (const body of requests) {
      const res = await postWebhook(baseUrl, body);
      expect(res.status).toBe(200);
    }
  }, 30000);
});
