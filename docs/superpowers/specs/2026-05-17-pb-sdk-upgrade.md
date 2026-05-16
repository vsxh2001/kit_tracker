# PocketBase JS SDK Upgrade — Spec

Status: **APPROVED — ready for implementation**
Date: 2026-05-17
Owner: hadassi

## 1. Goal

Upgrade the PocketBase JS SDK from `^0.21.5` to the latest `^0.22.x` (or `^0.23.x` if compatible) to remove the documented ticking time bomb where the pinned client mismatches the v0.22 server. Match SDK behavior to server semantics. Verify no regressions in OAuth, auto-cancellation, realtime, file uploads.

## 2. Context

CLAUDE.md says:

> `pocketbase` JS SDK is pinned to `^0.21.x` in `frontend/package.json`. PB server is **v0.22.22**. SDK v0.22+ rewrote the auth-methods response schema for v0.23+ servers — calls `/auth-methods?fields=mfa,otp,password,oauth2` and reads `response.oauth2.providers`. PB v0.22 returns `{authProviders: [...]}` at top level. Mismatch crashes OAuth with `TypeError: Cannot read properties of undefined (reading 'providers')`. Email/password is stable across versions, so the bug is OAuth-only.
>
> **Don't bump pocketbase casually.** When upgrading PB server (migrator agent territory), bump SDK in lockstep.

This sprint bumps the SDK alongside any server-side compatibility shim needed. Server stays on v0.22.22 for now.

## 3. Scope

### In scope

- Bump `frontend/package.json` to the latest `pocketbase` SDK compatible with PB server v0.22.
- Audit every call site (`services/*.ts`, `context/AuthContext.tsx`, `components/*.tsx`) for API changes:
  - `pb.collection().getList/getFullList/getOne/create/update/delete`
  - `pb.collection().authWithPassword/authWithOAuth2`
  - `pb.collection().subscribe/unsubscribe`
  - `pb.authStore.onChange/clear/token/model`
  - `pb.files.getUrl`
- Fix OAuth call site for v0.22+ schema (`response.oauth2.providers` vs `authProviders`).
- Re-test auto-cancellation behavior (per CLAUDE.md gotcha — every `load()` needs `err?.isAbort` catch + parallel calls need unique `requestKey`).
- Vite restart sequence to swap pre-bundled dep version per CLAUDE.md "Vite restart gotcha".
- Update CLAUDE.md to reflect new pinned version + remove the time-bomb caveat.

### Out of scope

- PB server upgrade (separate migrator-agent sprint).
- New features that depend on v0.23+ SDK (MFA, OTP) — out unless they fall out for free.
- Bumping any other npm dep.

## 4. Implementation tasks

### SDK-T1 — Bump SDK + verify build

- `cd frontend && npm install pocketbase@<latest-compatible>`
- `npm run lint && npm run build`
- Capture all TypeScript errors. Most likely: auth method signatures, oauth response shape.
- Commit `chore(deps): bump pocketbase JS SDK ^0.21 → ^0.22 (or ^0.23)` with package.json + package-lock.json.

### SDK-T2 — Fix OAuth call site

- Locate `pb.collection("users").authWithOAuth2(...)` in `services/auth.ts:loginWithGoogle()`.
- Per SDK v0.22+, the response shape changed. Verify against the new SDK's TypeScript definitions.
- Add a defensive read: `response.meta?.oauth2 ?? response.authProviders` — covers both server shapes if server upgrades later.
- Commit `fix(auth): adapt OAuth call site for new SDK response shape`.

### SDK-T3 — Audit + fix breaking API changes

- For each service file under `frontend/src/services/`, run `npx tsc --noEmit` and resolve errors.
- Common breaks:
  - `getList<T>(page, perPage, options)` — generic position may have moved
  - `subscribe(topic, callback)` — second arg now requires options object in v0.23+
  - `files.getUrl(record, filename)` — moved to `pb.files.getURL` (capital R) in some versions
- One commit per fixed file family.

### SDK-T4 — Vite cache bust + dev verify

- Kill all vite workers: `pkill -f "vite.*5173"`
- `rm -rf node_modules/.vite`
- `npm run dev -- --force`
- Manually walk: login (email/pass + Google OAuth if configured), list kits, create kit, move kit, subscribe to realtime (e.g., role-change), upload file. Document any console errors.

### SDK-T5 — E2E full suite

- `npm run test:full`
- Triage any failures. Many e2e specs use the SDK indirectly via the app; some helpers use it directly.

### SDK-T6 — Update CLAUDE.md

- Remove the "Don't bump pocketbase casually" caveat from the PB SDK version section.
- Replace with new pinned version + note: "Upgraded 2026-05-17 to ^X.Y via worktree-pb-sdk-upgrade."

## 5. Verification

- `npm run build` exit 0
- `npm run test:full` green (or any failures triaged + fixed)
- Manual smoke: login flow (both methods), kit CRUD, realtime role update
- CI green on the branch

## 6. Risks

| Risk | Mitigation |
|---|---|
| OAuth flow breaks again | Defensive reader covering both shapes; manual test in browser before merge |
| Realtime subscription API silently changes (returns nothing) | E2E spec `auth-realtime.spec.ts` covers role-promotion realtime — should catch |
| Vite cache trips up dev verification | Documented restart sequence in spec; SDK-T4 codifies it |
| File-upload URL helper renamed | TypeScript will catch — error surfaces at build time |
| New SDK requires v0.23+ server features (MFA/OTP) that PB v0.22 server doesn't expose | Pick the SDK version with explicit v0.22 server support; latest may be too aggressive |

## 7. Done criteria

- [ ] SDK bumped + lockfile committed
- [ ] OAuth call site adapted
- [ ] All TS errors resolved
- [ ] E2E full suite green
- [ ] CLAUDE.md updated
- [ ] PR opened with merge-ready status
