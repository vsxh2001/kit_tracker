import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import vm from "node:vm";
import {
  readdirSync,
  readFileSync,
  existsSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Smoke coverage for ALL PB hooks (HUT-T6). Two layers:
//   1. Syntax check — each pb_hooks/*.pb.js compiles (catches parse errors).
//   2. Boot check — PocketBase loads the full hooks dir with no load failure.
//
// Why a dedicated boot check: PB starts successfully ("Server started") EVEN
// WHEN a hook throws at load time — it just logs "Failed to execute <file>:"
// plus the JS error (e.g. ReferenceError from a Goja module-scope bug) and
// carries on. So the harness's normal startPb (which resolves on "Server
// started") would silently miss a broken hook. Here we capture the full boot
// output and assert it is free of load-failure markers.

const HOOKS_DIR = join(process.cwd(), "pb/pb_hooks");
const MIGRATIONS_DIR = join(process.cwd(), "pb/pb_migrations");
const PB_BINARY = join(process.cwd(), "pb/pocketbase");

const hookFiles = readdirSync(HOOKS_DIR).filter((f) => f.endsWith(".pb.js"));

describe("pb_hooks smoke", () => {
  it("has hook files to test", () => {
    expect(PB_BINARY && existsSync(PB_BINARY)).toBe(true);
    expect(hookFiles.length).toBeGreaterThan(0);
  });

  it.each(hookFiles)("%s compiles without a syntax error", (file) => {
    const src = readFileSync(join(HOOKS_DIR, file), "utf8");
    // vm.Script compiles without executing, so Goja-only globals being
    // undefined here is irrelevant — we only catch parse/syntax errors.
    expect(() => new vm.Script(src, { filename: file })).not.toThrow();
  });

  it(
    "PocketBase boots with the full hooks dir and no load failures",
    async () => {
      const dataDir = mkdtempSync(join(tmpdir(), "pb-smoke-"));
      const port = 40000 + Math.floor(Math.random() * 10000);
      const proc = spawn(
        PB_BINARY,
        [
          "serve",
          `--http=127.0.0.1:${port}`,
          `--dir=${dataDir}`,
          `--hooksDir=${HOOKS_DIR}`,
          `--migrationsDir=${MIGRATIONS_DIR}`,
        ],
        { stdio: ["ignore", "pipe", "pipe"] }
      );

      let output = "";
      const accumulate = (c) => (output += c.toString());
      proc.stdout.on("data", accumulate);
      proc.stderr.on("data", accumulate);

      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("PB boot timeout:\n" + output)),
            20000
          );
          const onStarted = (c) => {
            if (c.toString().includes("Server started")) {
              clearTimeout(timer);
              proc.stdout.off("data", onStarted);
              // Give any deferred hook-eval errors a tick to flush.
              setTimeout(resolve, 500);
            }
          };
          proc.stdout.on("data", onStarted);
          proc.on("exit", (code) => {
            clearTimeout(timer);
            reject(new Error(`PB exited early (code ${code}):\n` + output));
          });
        });
      } finally {
        proc.kill("SIGKILL");
        rmSync(dataDir, { recursive: true, force: true });
      }

      // PB logs "Failed to execute <file>:" then the JS error (ReferenceError,
      // etc.) when a hook throws at load — but it does NOT crash. Anchor on that
      // marker plus an actual crash; syntax errors are already caught by the
      // per-file vm.Script check above. We deliberately do NOT match bare
      // "ReferenceError"/"TypeError" strings, since a future migration logging
      // those words in prose would false-fail this gate.
      const failureMarkers = [
        /Failed to execute .+\.pb\.js/,
        /\bpanic:/i,
      ];
      const hits = failureMarkers
        .filter((re) => re.test(output))
        .map((re) => re.toString());
      expect(hits, `hook load failure in boot output:\n${output}`).toEqual([]);
    },
    30000
  );
});
