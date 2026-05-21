# P1 RCA: prod-smoke /audit and /components tests always fail

## Symptom

`prod-smoke` CI job fails (job timeout 5 min) on every run since the job was
introduced in commit `fdb93be`. Both tests that navigate to in-app pages time
out at the full Playwright action timeout (30 s per attempt × 3 retries = 3 min
minimum for two tests):

```
✘ /audit page renders without console errors @smoke (30.0s)
✘ /components page renders with rows (filter:undefined bug) @smoke (30.0s)
```

Log source: CI run 26189759807, job 77054868225 (2026-05-20).

## Repro

```bash
cd frontend
VITE_PB_URL="/" npm run build
npx serve dist -l 5174 &           # no -s flag  ← root cause
npx playwright test e2e/prod-smoke.spec.ts --project=chromium \
  -x --timeout=35000 \
  -e PLAYWRIGHT_TEST_BASE_URL=http://localhost:5174
# → all tests that call loginAs() hang 30 s then fail
```

## Root Cause

`.github/workflows/ci.yml` line 171:

```yaml
- name: Serve prod dist on 5174
  run: cd frontend && npx serve dist -l 5174 &
```

`npx serve` without the `-s` flag is a plain static file server.  It returns
HTTP 404 for any path that is not a real file on disk (`/login`, `/audit`,
`/components`, etc.) instead of serving `dist/index.html`.

React Router uses HTML5 `BrowserRouter` — routes only exist client-side.  The
server must rewrite every non-asset request to `index.html` (SPA mode).
Without `-s`, navigating to `/login` returns serve's own 404 HTML page (not
the React app).  The Playwright `loginAs()` helper then calls
`page.getByLabel("Email")` which looks for the React login form — it never
appears — and Playwright waits the full 30-second action timeout before
failing.

This is why:
- **dev e2e passes**: Vite dev server has SPA rewriting built in.
- **prod-smoke always fails**: `serve` without `-s` does not rewrite.
- **No `filter:undefined` bug found**: `services/components.ts` only sets
  `params.filter` when `filters.length > 0`; the flag is never added as
  `undefined`. The test never reaches the component fetch because login fails
  first.

## Affected File and Line

`.github/workflows/ci.yml`, line 171 — `npx serve dist -l 5174 &`

## Proposed Fix

Add the `-s` flag (SPA single-page-app rewrite mode) so every non-asset path
is served as `index.html`:

```diff
-  run: cd frontend && npx serve dist -l 5174 &
+  run: cd frontend && npx serve dist -s -l 5174 &
```

This is a one-character word addition.  No schema, migration, or frontend
source changes are required.

## Out-of-scope

- `frontend/src/pages/ComponentsPage.tsx` — no change needed.
- `frontend/src/services/components.ts` — no change needed; `filter:undefined`
  bug does not exist here.
- `e2e/prod-smoke.spec.ts` — tests are correct; they test the right thing.
