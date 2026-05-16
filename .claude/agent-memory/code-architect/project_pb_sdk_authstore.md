---
name: PB SDK persists auth token in localStorage
description: PocketBase JS SDK persists auth token in localStorage["pocketbase_auth"] by default; any same-origin XSS yields full account takeover
type: project
---

The pinned `pocketbase@^0.21.x` SDK uses `LocalAuthStore` by default — token + user record live in `localStorage["pocketbase_auth"]` on the SPA origin. This is the standard PB pattern and not configurable away from localStorage without subclassing the auth store.

**Why this matters:** Any same-origin XSS (script execution on the SPA's origin) can read `localStorage["pocketbase_auth"]` and ship the token off-site. The token grants the attacker the full PB session of that user until the token expires (PB default: 14 days; not currently overridden). Cookie-with-HttpOnly would mitigate exfiltration but PB v0.22 doesn't offer a built-in cookie auth flow for browsers.

**How to apply:** Any same-origin XSS finding is automatically HIGH-severity because of this. Don't classify XSS as "stored-only, low impact" without noting the token exfiltration path. When evaluating CSP, file serving (attachments), or content sanitization, weigh this against the cost of breaking PB SDK functionality. CSRF is N/A here — auth is `Authorization` header based, not cookie based, so the CORS `*` setting on PB is acceptable.
