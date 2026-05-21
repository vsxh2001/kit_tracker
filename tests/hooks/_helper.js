import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

// Resolve repo root: in a git worktree, .git is a file containing
// "gitdir: <path>" pointing to the main .git/worktrees/<name>.
// Walk up to the actual repo root to find the shared pb/pocketbase binary.
function findRepoRoot() {
  const cwd = process.cwd();
  const gitPath = join(cwd, ".git");
  if (existsSync(gitPath)) {
    try {
      const content = readFileSync(gitPath, "utf8").trim();
      if (content.startsWith("gitdir:")) {
        // .git/worktrees/<name> → go up three levels to repo root
        const gitdir = content.replace("gitdir:", "").trim();
        return dirname(dirname(dirname(gitdir)));
      }
    } catch (_) {}
  }
  return cwd;
}

const REPO_ROOT = findRepoRoot();
const LOCAL_PB = join(process.cwd(), "pb/pocketbase");
const REPO_PB = join(REPO_ROOT, "pb/pocketbase");
const PB_BINARY = existsSync(LOCAL_PB) ? LOCAL_PB : REPO_PB;
const HOOKS_DIR = join(process.cwd(), "pb/pb_hooks");
const MIGRATIONS_DIR = join(process.cwd(), "pb/pb_migrations");

let _instance = null;

export async function startPb({ port = 0 } = {}) {
  const realPort = port || (40000 + Math.floor(Math.random() * 10000));
  const dataDir = mkdtempSync(join(tmpdir(), "pb-test-"));
  const proc = spawn(PB_BINARY, [
    "serve",
    `--http=127.0.0.1:${realPort}`,
    `--dir=${dataDir}`,
    `--hooksDir=${HOOKS_DIR}`,
    `--migrationsDir=${MIGRATIONS_DIR}`,
  ], { stdio: ["ignore", "pipe", "pipe"] });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("PB start timeout")), 15000);
    proc.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("Server started")) {
        clearTimeout(timer);
        resolve();
      }
    });
    proc.stderr.on("data", (chunk) => {
      const s = chunk.toString();
      if (/panic|fatal/i.test(s)) reject(new Error("PB startup error: " + s));
    });
  });

  // PB v0.22 uses `admin create` (not `superuser create`)
  await runCli(`"${PB_BINARY}" admin create test@example.com Testpass123! --dir=${dataDir}`);

  const baseUrl = `http://127.0.0.1:${realPort}`;
  const suToken = await authSuperuser(baseUrl, "test@example.com", "Testpass123!");

  await fetch(`${baseUrl}/api/collections/users/records`, {
    method: "POST",
    headers: { Authorization: suToken, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@hook-test.local",
      password: "Adminpass1!",
      passwordConfirm: "Adminpass1!",
      role: "admin",
      name: "Hook Test Admin",
    }),
  });

  _instance = { proc, dataDir, port: realPort, baseUrl, suToken };
  return _instance;
}

export async function stopPb() {
  if (!_instance) return;
  _instance.proc.kill("SIGTERM");
  await new Promise((r) => _instance.proc.once("exit", r));
  rmSync(_instance.dataDir, { recursive: true, force: true });
  _instance = null;
}

export async function authSuperuser(baseUrl, email, password) {
  // PB v0.22 uses /api/admins/auth-with-password (identity field = email)
  const res = await fetch(`${baseUrl}/api/admins/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: email, password }),
  });
  if (!res.ok) throw new Error(`SU auth failed: ${res.status}`);
  const data = await res.json();
  return data.token;
}

export async function authUser(baseUrl, email, password) {
  const res = await fetch(`${baseUrl}/api/collections/users/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: email, password }),
  });
  if (!res.ok) throw new Error(`User auth failed: ${res.status}`);
  const data = await res.json();
  return data.token;
}

async function runCli(cmd) {
  const { exec } = await import("node:child_process");
  return new Promise((resolve) => {
    exec(cmd, { cwd: process.cwd() }, () => resolve());
  });
}
