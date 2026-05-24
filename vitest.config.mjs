import { defineConfig } from "vitest/config";

// Hook tests (tests/hooks/*.test.js) each boot their own PocketBase instance on a
// random port (see tests/hooks/_helper.js). Running test files in parallel lets two
// boots pick the same port → bind failure → 15s boot timeout → spurious CI failures
// that grow more likely as the suite adds files. Serialize file execution so only one
// PocketBase runs at a time; total runtime stays well under the 2-min budget.
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
