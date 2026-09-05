import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    // Unit tests exercise pure logic, never real infra — skip T3 env validation so importing a
    // module that pulls in ~/env (loader, retrieval) doesn't demand a live DATABASE_URL etc.
    env: { SKIP_ENV_VALIDATION: "true" },
  },
});
