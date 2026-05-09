---
name: Playwright Selector Patterns
description: Reliable selectors for Radix UI components in kit-tracker — verified in live session
type: project
---

Radix combobox/select: `[role="combobox"]:has-text("placeholder text")` to open, `[role="option"]:has-text("text")` to select.
Radix dialog: `[role="dialog"]` for the container; scoped selectors like `[role="dialog"] button:has-text("Save")`.
Table row scoped: `tr:has-text("Row Name") button:has-text("Edit")`.
Input by placeholder: `input[placeholder="text"]` — note: Playwright fill() not type() for clearing+filling.
ref= selectors (from snapshots) do NOT work as CSS selectors — must use role/text/placeholder selectors.
