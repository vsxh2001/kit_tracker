---
name: Playwright Selector Patterns
description: Reliable selectors for Radix UI components in kit-tracker — verified in live session
type: project
---

## Dialog selectors — CRITICAL
The mobile nav `<aside>` has `role="dialog" aria-label="Navigation menu"` which appears
BEFORE the actual modal dialog in DOM order. ALWAYS exclude it:
```ts
// Wait for modal:
page.locator('[role="dialog"]:not([aria-label="Navigation menu"])').waitFor({ state: "visible" })
// Scope selectors inside modal:
page.locator('[role="dialog"]:not([aria-label="Navigation menu"]) [role="combobox"]')
```

## Dialog submit button labels (exact names)
- New Kit dialog → `getByRole("button", { name: "Save" })`
- Move Kit dialog → `getByRole("button", { name: "Move kit" })`
- Add Maintenance Schedule dialog → `getByRole("button", { name: "Add schedule" })`
- Add On-Call Shift dialog → `getByRole("button", { name: "Add shift" })`
- Add Component dialog → `getByRole("button", { name: "Create" })`
- New Product → button labeled "Add product" (not "New product")
- New Component → button labeled "New component" (header) / "Add Component" (dialog)

## Other reliable patterns
Radix combobox/select: `[role="combobox"]:has-text("placeholder text")` to open, `[role="option"]:has-text("text")` to select.
Table row scoped: `tr:has-text("Row Name") button:has-text("Edit")`.
Input by placeholder: `input[placeholder="text"]` — note: Playwright fill() not type() for clearing+filling.
ref= selectors (from snapshots) do NOT work as CSS selectors — must use role/text/placeholder selectors.
Table cell strict mode: use `.first()` when kit/product names appear in both toast AND table row.
"Move" button scoping: `/move kit|move/i` regex matches both "Move kit" (detail action) and "Move" (component row).
  Use exact `{ name: "Move kit" }` for the detail page action button.
