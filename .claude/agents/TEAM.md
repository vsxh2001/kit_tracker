# Kit Tracker Agent Team — Orchestrator Guide

## Team roster

| Agent | Model | When to use |
|-------|-------|-------------|
| `debugger` | sonnet | Specific reproducible error. You have: error text, file, reproduce command. |
| `implementer` | sonnet | Build a feature from a complete spec. Architecture already decided. |
| `db-engineer` | sonnet | PocketBase schema/migration work. New fields, rule changes, indexes. |
| `devops` | haiku | CI failure, Dockerfile break, workflow change. Infrastructure pattern matching. |
| `reviewer` | opus | Independent second opinion after significant implementation. Read-only. |
| `test-fixer` | haiku | Repair a specific broken Playwright test. Does NOT write new tests. |
| `migrator` | opus | PocketBase version upgrade. Touches all 6 affected files atomically. |
| `data-analyst` | haiku | Read-only DB queries. "What kits are at entity X?" "How many open requests?" |
| `code-architect` | opus | Design decision. "How should we structure X?" before building. |
| `qa-playwright-specialist` | sonnet | Write new Playwright e2e tests for a user flow. |
| `product-manager` | opus | Feature prioritization, roadmap, "should we build X?" |

---

## Core principle: give agents a scalpel, not a shovel

**Bad brief** → "Fix the CI." (Too vague — agent will thrash and burn context)

**Good brief** → Exact error, exact file, exact stop condition. Agent handles only that.

Tight constraint = better output. If you're uncertain what to constrain, that's a sign you need `code-architect` first.

---

## Brief templates

### debugger

```
Error: <paste exact error text>
File: <path/to/file.ts:line if known>
Reproduce: <exact shell command>
Stop when: <command that must return 0>
Do NOT: touch other files, refactor, add error handling beyond the fix
```

### implementer

```
Implement: <function/component name> in <path/to/file.ts>
Contract: <function signature or props interface>
Types at: src/types/index.ts:<line>
Pattern: <path/to/similar-file.ts> — follow its style exactly
Pass: cd frontend && npm run lint && npm run build
Do NOT: <list of files/areas to stay out of>
Notes: <any project-specific gotchas relevant to this task>
```

### db-engineer

```
Change: <what schema change — add field / change rule / add index>
Reason: <why — bug, new feature, compliance>
Current migrations: read pb/pb_migrations/ — latest is <filename>
Test with: PB_URL=http://127.0.0.1:8090 + verify collection exists/field present
Do NOT: touch application code, change rules beyond what's described
```

### devops

```
Failure: <paste exact CI log lines — at minimum the error line + 5 lines before>
File: <.github/workflows/ci.yml OR Dockerfile OR pb/script.sh>
Pass when: CI job shows ✓ for <job name>
Do NOT: change application code, restructure working CI steps
```

### reviewer

```
Changed files:
  - path/to/file1.ts
  - path/to/file2.tsx
Context: <one sentence — what this change is supposed to do>
Focus on: <specific concerns — e.g. "atomicity of fulfillRequest", "role gating on new button">
```

### test-fixer

```
Failing test: "<exact test name from test('...')"
Spec file: frontend/e2e/<spec>.spec.ts
Error: <paste failure output>
Reproduce: cd frontend && npx playwright test e2e/<spec>.spec.ts --project=chromium --grep "<test name>"
Stop when: that command exits 0
Do NOT: touch app code, touch passing tests, change API helpers beyond adding missing fields
```

### migrator

```
Target version: 0.XX.X
Current version: 0.22.22
Reason: <why upgrading>
Changelog URL: https://github.com/pocketbase/pocketbase/releases/tag/v0.XX.X
Test with: run setup_collections.sh + seed_test_users.sh locally after binary swap
Do NOT: change collection schema, touch frontend code
```

### data-analyst

```
Question: <what you want to know about the data>
PB admin: <email> / <password>
Scope: <any filters — time range, specific entity/kit, status>
```

### code-architect

```
Decision needed: <what architectural question — e.g. "how to add caching for kit holder lookup">
Context: <relevant constraints — performance, data model, existing patterns>
Current approach: <what we have now>
Options I'm considering: <list if any>
Return: recommendation + tradeoffs, NOT implementation
```

---

## Workflow patterns

### Bug reported → fix deployed

1. Reproduce locally
2. If cause is obvious → fix inline
3. If cause is unclear → spawn `debugger` with exact error + reproduce command
4. After fix → spawn `reviewer` if change touches critical paths (fulfillRequest, auth, role gates)
5. Lint + build → commit → push

### New feature request

1. If architectural question → spawn `code-architect` first
2. Get design decision, agree on contract
3. If schema changes needed → spawn `db-engineer`
4. Spawn `implementer` with tight spec
5. Spawn `reviewer` for independent check
6. Spawn `qa-playwright-specialist` if flow is user-facing
7. Commit + push

### CI broken

1. `gh run view <run-id> --log-failed` → copy exact failure
2. Identify which job/step
3. Spawn `devops` with failure log + file + pass condition
4. If it's an app code issue (not infra) → redirect to `debugger`

### Schema change

1. Spawn `db-engineer` with change description + reason
2. DB engineer writes migration, tests locally
3. Spawn `reviewer` to check rules/invariants
4. Commit migration file

---

## Parallelism rules

- Independent audits → parallel spawns OK (e.g. reviewer + qa-playwright running together)
- Sequential dependency → wait for result before spawning next (e.g. architect before implementer)
- Max 3 parallel agents — beyond that, context overhead defeats the benefit

## Do not delegate

- Short edits (< 10 lines) you can do inline — spawning costs more than doing it
- Tight feedback loops (error → tweak → error → tweak) — stay inline
- Reading and understanding code — that's your job, not an agent's
