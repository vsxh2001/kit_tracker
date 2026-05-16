# PocketBase Hook Unit Tests — Spec

Status: **APPROVED — ready for implementation**
Date: 2026-05-17
Owner: hadassi

## 1. Goal

Add a Node-based integration test harness that exercises every PB hook in `pb/pb_hooks/` against a fresh ephemeral PocketBase instance. Catches regressions like the cascade-audit-enum mismatch (T30 P0) and Goja-scope bugs (T29) BEFORE they ship.

## 2. Context

25 PB hooks live in `pb/pb_hooks/`. Zero unit-test coverage today. The pilot sprint surfaced 4 hook bugs via reviewer (cascade audit enum, Goja module-scope, `c.set` dead code, T31 NULL-vs-1 quantity coercion). Each one ate a fix-loop cycle. A test harness amortizes the cost.

## 3. Scope

### In scope

- Test runner: vitest (already a JS test framework familiar to the team; lightweight). Or Node native test runner if vitest is heavy.
- Per-hook test file in `tests/hooks/*.test.js` mirroring `pb/pb_hooks/*.pb.js`.
- Helper: `tests/hooks/_helper.js` that boots PB on an ephemeral port (random + retry), applies migrations, seeds a superuser + test user, yields a `pb` SDK instance pointing at it. Teardown wipes the data dir.
- One CI workflow step `npm run test:hooks` that runs all hook tests against a fresh PB.
- Cover the 5 hooks most touched in pilot sprint:
  - `cascade_delete.pb.js` (audit row write, blocker checks, role gate, confirm-text)
  - `wa_inbound.pb.js` (write-intent regex, RETURN shortcut role gate, idempotency)
  - `audit_log.pb.js` (via tagging from each surface)
  - `components_product_serialized_check.pb.js` (serialized/bulk validation, quantity null)
  - `role_change_check.pb.js` (admin-only role mutation)

Other 20 hooks: add stubs that import the hook file + assert it loads without panic (smoke). Real assertions added incrementally.

### Out of scope

- Mocking the Anthropic API for ai_chat tests (use real API key from env, skip if absent).
- Twilio sandbox interaction tests (existing `scripts/wa_e2e_test.sh` covers).
- Mutation testing / coverage reports.
- Cross-hook integration tests (single-hook per test file).

## 4. Implementation

### HUT-T1 — Harness + first hook test (cascade_delete)

- New: `tests/hooks/_helper.js` — boot PB, seed users, return SDK + admin token.
- New: `tests/hooks/cascade_delete.test.js` — covers the 8 scenarios from `scripts/cascade_delete_test.sh` rewritten as vitest assertions:
  1. Non-admin → 403
  2. Invalid collection → 400 invalid_collection
  3. Wrong confirm_text → 400 confirm_mismatch
  4. Kit cascade success → counts match preview + audit row exists with `action=cascade_delete`
  5. Entity with active tx → 400 blocked + correct blocker list
  6. Empty entity cascade success
  7. Component cascade with component_transactions
  8. Single transaction delete
- `package.json` script: `test:hooks` → `vitest run tests/hooks`
- CI: add a step in `.github/workflows/ci.yml` after build → before e2e.

### HUT-T2 — wa_inbound role-gate test

- New: `tests/hooks/wa_inbound.test.js`
- Mock the Twilio outbound (`replyViaTwilio`) via a fixture — capture replies in-memory rather than HTTP-POST to Twilio.
- Scenarios:
  - Viewer sends "return X" → reply contains "Only admins or technicians" + no transaction created
  - Technician sends "return X" → confirm prompt → YES → transaction created
  - Admin sends "move X to Y" + ignore (not YES) → pending cleared, no transaction
  - Duplicate MessageSid within 1h → no duplicate processing

### HUT-T3 — audit_log via-tag tests

- New: `tests/hooks/audit_log.test.js`
- Trigger writes from each surface (web REST, MCP, AI chat, wa_inbound), verify `audit_log.changes.via` matches expected (web / mcp / ai-agent / wa-bot).
- Avoids the entire class of regressions from sprint reviewer round 1.

### HUT-T4 — components_product_serialized_check tests

- New: `tests/hooks/components_product_serialized_check.test.js`
- Serialized product → component with quantity=5 → DB stores NULL (via After-hook raw SQL).
- Bulk product → component without serial → OK; with serial → 400.
- Update path also covered.

### HUT-T5 — role_change_check tests

- New: `tests/hooks/role_change_check.test.js`
- Admin promotes user → OK.
- Non-admin attempts to change own role → 400 "Only admins can change user roles."
- Last admin attempts self-demotion → blocked by last_admin_check hook (cross-hook interaction, acceptable).

### HUT-T6 — Smoke load for remaining 20 hooks

- New: `tests/hooks/_smoke.test.js`
- Imports each `pb/pb_hooks/*.pb.js` file via Node + asserts no parse/syntax errors.
- Boots PB with the full `pb_hooks/` dir + asserts startup log contains no "panic" or "ReferenceError" lines.
- Catches the next Goja-scope or missing-function regression at PR time.

### HUT-T7 — CI integration

- `.github/workflows/ci.yml` — new `test:hooks` step right after build, before e2e.
- Step env: `PB_SUPERUSER_EMAIL`, `PB_SUPERUSER_PASSWORD` (same as e2e step from earlier sprint).

### HUT-T8 — README + CLAUDE.md update

- README: add "Hook tests" section under Commands.
- CLAUDE.md: add note that hooks now have unit-test coverage + how to add a new test when you add a new hook.

## 5. Verification

- `npm run test:hooks` exits 0 locally
- CI step green
- Total hook test runtime < 2 min (vitest is fast; PB boot ~3s × 6 test files = ~20s)

## 6. Risks

| Risk | Mitigation |
|---|---|
| PB boot time per test file is slow → flaky CI | Reuse one PB instance across tests in same file; teardown between tests by `dao.deleteRecord` not full restart |
| Goja JS hooks behave differently when invoked via REST vs DAO direct write | Test harness only exercises REST path; matches production reality |
| Tests need a real Anthropic API key (ai_chat) | `test.skip(!process.env.ANTHROPIC_API_KEY)` per test that exercises AI |
| New hook added without a test | Linting rule: presence of `pb/pb_hooks/X.pb.js` requires `tests/hooks/X.test.js` (enforced via a tiny script in pre-commit or CI) |

## 7. Done criteria

- [ ] vitest installed; `test:hooks` script wired
- [ ] 5 priority hooks have real tests passing locally
- [ ] Smoke test loads all 25 hook files
- [ ] CI step green
- [ ] CLAUDE.md + README updated
- [ ] PR opened
