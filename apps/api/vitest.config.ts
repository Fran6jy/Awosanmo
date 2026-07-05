import { defineConfig } from "vitest/config";

// Point the app at an isolated throwaway SQLite DB and deterministic secrets so
// tests never touch real data. These env vars are read by src/config.ts at import.
export default defineConfig({
  test: {
    env: {
      NODE_ENV: "test",
      DATA_DIR: "./data-test",
      DB_PATH: "./data-test/awosanmo-test.sqlite",
      JWT_SECRET: "test-secret-please-change",
      ADMIN_EMAIL: "admin@test.local",
      ADMIN_PASSWORD: "password123",
    },
    // A single shared SQLite file — don't run files in parallel against it.
    fileParallelism: false,
    include: ["src/**/*.test.ts"],
  },
});
