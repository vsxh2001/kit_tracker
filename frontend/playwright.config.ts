import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // PocketBase is shared state — run serially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    launchOptions: {
      ...(process.env.CI ? {} : { executablePath: "/usr/bin/google-chrome" }),
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Health-check both backing servers before tests run. PocketBase (8090) and
  // Vite (5173) must already be running — these entries fail fast with a clear
  // message instead of timing out test-by-test if a server is down.
  webServer: [
    {
      command:
        'echo "PocketBase must be running on 8090 — start with ./pb/pocketbase serve --dir=pb/pb_data" && exit 1',
      url: "http://127.0.0.1:8090/api/health",
      reuseExistingServer: true,
      timeout: 5_000,
    },
    {
      command:
        'echo "Vite must be running on 5173 — start with cd frontend && npm run dev" && exit 1',
      url: "http://localhost:5173",
      reuseExistingServer: true,
      timeout: 5_000,
    },
  ],
});
