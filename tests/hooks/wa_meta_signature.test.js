import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHmac } from "node:crypto";
import { startPb, stopPb } from "./_helper.js";

// Meta signs the X-Hub-Signature-256 header as HMAC-SHA256 of the RAW request
// body bytes with the app secret. The webhook re-implements SHA-256/HMAC in
// pure JS (Goja has no crypto). This suite is the ground-truth guard: node's
// crypto is the reference. The non-ASCII case specifically guards against the
// double-encoding regression where readerToString's byte-per-char output was
// re-UTF-8-encoded, breaking verification for Hebrew/emoji bodies in prod.

const APP_SECRET = "test_app_secret_0123456789abcdef";

function sign(body) {
  return "sha256=" + createHmac("sha256", APP_SECRET).update(Buffer.from(body, "utf8")).digest("hex");
}

async function postWebhook(baseUrl, body, sigHeader) {
  const headers = { "Content-Type": "application/json" };
  if (sigHeader !== null) headers["X-Hub-Signature-256"] = sigHeader;
  return fetch(`${baseUrl}/api/wa/meta/webhook`, { method: "POST", headers, body });
}

// Benign non-message event (field != "messages") → hook acks 200 without
// touching kits or attempting outbound Graph API calls. The signed bytes still
// cover the whole body, so this exercises the verification path in isolation.
function event(extra) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "statuses", value: { note: extra } }] }],
  });
}

describe("wa_meta_webhook X-Hub-Signature-256 verification", () => {
  let baseUrl;

  beforeAll(async () => {
    // Hook reads $os.getenv("WHATSAPP_APP_SECRET") at call time; startPb spawns
    // PB inheriting process.env, so set it before boot to enforce verification.
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;
    delete process.env.WA_SKIP_SIGNATURE_CHECK;
    const pb = await startPb();
    baseUrl = pb.baseUrl;
  }, 60000);

  afterAll(async () => {
    await stopPb();
    delete process.env.WHATSAPP_APP_SECRET;
  });

  it("accepts a correctly-signed ASCII body", async () => {
    const body = event("hello world");
    const res = await postWebhook(baseUrl, body, sign(body));
    expect(res.status).toBe(200);
  });

  it("accepts a correctly-signed non-ASCII body (Hebrew + emoji)", async () => {
    // Regression guard: HMAC must run over the exact UTF-8 bytes Meta signed.
    const body = event("שלום עולם 📦 דָּנִיֵּאל");
    const res = await postWebhook(baseUrl, body, sign(body));
    expect(res.status).toBe(200);
  });

  it("rejects a body with a wrong signature (403)", async () => {
    const body = event("hello world");
    const res = await postWebhook(baseUrl, body, "sha256=" + "0".repeat(64));
    expect(res.status).toBe(403);
  });

  it("rejects a tampered body whose signature no longer matches (403)", async () => {
    const sig = sign(event("original"));
    const res = await postWebhook(baseUrl, event("tampered"), sig);
    expect(res.status).toBe(403);
  });

  it("rejects an unsigned POST when the secret is set (403)", async () => {
    const body = event("hello world");
    const res = await postWebhook(baseUrl, body, null);
    expect(res.status).toBe(403);
  });
});
