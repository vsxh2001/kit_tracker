#!/usr/bin/env node
/**
 * audit-find-records.mjs
 *
 * Scans every pb/pb_hooks/*.pb.js file and parses each findRecordsByFilter(...)
 * call to check for the broken pattern: limit=0 (4th positional arg is literal 0)
 * combined with a positive integer offset (5th positional arg > 0).
 *
 * PB v0.22 signature:
 *   findRecordsByFilter(collection, filter, sort, limit, offset, params)
 *
 * In PB v0.22, limit=0 silently returns [] instead of all records. It does NOT
 * throw a visible error — the hook runs and produces wrong results silently.
 *
 * Exit 0 on success, exit 1 if any violation found.
 */

import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOKS_DIR = join(__dirname, "..", "pb", "pb_hooks");

/**
 * Extract all findRecordsByFilter call argument lists from source text.
 * Returns array of { line, args: string[] } where line is 1-based line number
 * of the opening paren and args are the raw text of each top-level argument.
 */
function extractCalls(source) {
  const results = [];
  const marker = "findRecordsByFilter";
  let i = 0;

  while (i < source.length) {
    const idx = source.indexOf(marker, i);
    if (idx === -1) break;

    // Check it's not inside a comment (single-line or block).
    // We use a simple heuristic: find the start of the line and check for //
    const lineStart = source.lastIndexOf("\n", idx) + 1;
    const prefix = source.slice(lineStart, idx);
    const trimmedPrefix = prefix.trimStart();
    if (trimmedPrefix.startsWith("//") || trimmedPrefix.startsWith("*")) {
      i = idx + marker.length;
      continue;
    }

    // Move past the marker name to find the opening paren
    let j = idx + marker.length;
    // Skip whitespace
    while (j < source.length && /\s/.test(source[j])) j++;

    if (source[j] !== "(") {
      i = idx + marker.length;
      continue;
    }

    // Compute 1-based line number of the '(' character
    const lineNum = source.slice(0, j).split("\n").length;

    // Now parse the argument list, respecting:
    //   - nested parens/brackets/braces (depth tracking)
    //   - string literals (single/double/template)
    //   - single-line and block comments
    j++; // skip opening paren
    const args = [];
    let current = "";
    let depth = 1; // we already consumed the opening paren
    let inString = false;
    let stringChar = "";
    let inBlockComment = false;
    let inLineComment = false;

    while (j < source.length && depth > 0) {
      const ch = source[j];
      const next = source[j + 1];

      if (inLineComment) {
        if (ch === "\n") inLineComment = false;
        j++;
        continue;
      }

      if (inBlockComment) {
        if (ch === "*" && next === "/") {
          inBlockComment = false;
          j += 2;
        } else {
          j++;
        }
        continue;
      }

      if (inString) {
        if (stringChar === "`") {
          // Template literal — handle ${ ... } but we don't need to for args parsing
          if (ch === "\\" ) {
            j += 2; // skip escaped char
            current += source.slice(j - 2, j);
            continue;
          }
          if (ch === "`") {
            inString = false;
            current += ch;
            j++;
            continue;
          }
        } else {
          if (ch === "\\") {
            current += source.slice(j, j + 2);
            j += 2;
            continue;
          }
          if (ch === stringChar) {
            inString = false;
            current += ch;
            j++;
            continue;
          }
        }
        current += ch;
        j++;
        continue;
      }

      // Not in string/comment
      if (ch === "/" && next === "/") {
        inLineComment = true;
        j += 2;
        continue;
      }
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        j += 2;
        continue;
      }

      if (ch === '"' || ch === "'" || ch === "`") {
        inString = true;
        stringChar = ch;
        current += ch;
        j++;
        continue;
      }

      if (ch === "(" || ch === "[" || ch === "{") {
        depth++;
        current += ch;
        j++;
        continue;
      }

      if (ch === ")" || ch === "]" || ch === "}") {
        depth--;
        if (depth === 0) {
          // End of argument list
          args.push(current.trim());
          break;
        }
        current += ch;
        j++;
        continue;
      }

      if (ch === "," && depth === 1) {
        args.push(current.trim());
        current = "";
        j++;
        continue;
      }

      current += ch;
      j++;
    }

    results.push({ line: lineNum, args });
    i = idx + marker.length;
  }

  return results;
}

/**
 * Returns true if the argument string is the integer literal 0.
 * Strips surrounding whitespace. Allows 0 as a number literal only.
 */
function isLiteralZero(arg) {
  return arg.trim() === "0";
}

/**
 * Returns true if the argument string is a positive integer literal (> 0).
 */
function isPositiveIntLiteral(arg) {
  const t = arg.trim();
  return /^\d+$/.test(t) && parseInt(t, 10) > 0;
}

// Main
const files = readdirSync(HOOKS_DIR)
  .filter((f) => f.endsWith(".pb.js"))
  .sort()
  .map((f) => join(HOOKS_DIR, f));

let totalCalls = 0;
let violations = 0;

for (const filePath of files) {
  const source = readFileSync(filePath, "utf8");
  const calls = extractCalls(source);
  totalCalls += calls.length;

  for (const { line, args } of calls) {
    // args[3] = limit (4th positional), args[4] = offset (5th positional)
    if (args.length >= 5) {
      const limitArg = args[3];
      const offsetArg = args[4];
      if (isLiteralZero(limitArg) && isPositiveIntLiteral(offsetArg)) {
        const shortPath = filePath.replace(process.cwd() + "/", "");
        console.error(
          `FAIL ${shortPath}:${line} — findRecordsByFilter limit=0 with offset=${offsetArg.trim()} is the broken anti-pattern (limit=0 silently returns [] in PB v0.22)`
        );
        violations++;
      }
    }
  }
}

if (violations > 0) {
  console.error(`\nFound ${violations} violation(s). Fix: swap limit/offset or use a non-zero limit.`);
  process.exit(1);
}

console.log(`OK: ${totalCalls} findRecordsByFilter call(s) audited, no anti-pattern found`);
