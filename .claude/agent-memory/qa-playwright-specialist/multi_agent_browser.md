---
name: Multi-Agent Browser Contention Pattern
description: Shared MCP browser causes session thrashing when multiple puppet agents run concurrently — mitigation strategies
type: feedback
---

MCP Playwright browser is a single shared Chrome instance across all parallel agent sessions. Any agent's login overwrites `pocketbase_auth` in localStorage, instantly destroying other agents' sessions.

**Why:** PocketBase auth is stored in `localStorage['pocketbase_auth']`. React `AuthContext` listens to `pb.authStore.onChange` which fires on every localStorage change. Concurrent logins = rapid session cycling.

**How to apply:**
- For multi-agent puppet shows: perform all data mutations via PocketBase REST API (`curl` bash calls with admin token), not via UI browser interactions. Use browser only for screenshot verification.
- For single-agent e2e tests: inject auth token via `page.evaluate(() => localStorage.setItem('pocketbase_auth', JSON.stringify({token, model})))` before navigation, not via UI login form. This is faster and immune to concurrent interference.
- Token injection pattern: POST to `/api/collections/users/auth-with-password` with `curl`, extract `token` + `record`, build `{token, model: record}` JSON, inject via `page.evaluate`.
- Always navigate to the target URL AFTER token injection (not before), as navigation triggers `pb.authStore` init from localStorage.
- Screenshot timing: even with correct token injected, a competing agent's concurrent snapshot can trigger HMR → React remount → auth re-read → redirect. Accept this as a known limitation in multi-agent concurrent browser use.
