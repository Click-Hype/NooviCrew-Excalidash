import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.integration.ts"],
    testTimeout: 30000,
    hookTimeout: 120000,
    env: {
      DATABASE_PROVIDER: "sqlite",
      DATABASE_URL: "file:./prisma/test.db",
      NODE_ENV: "test",
      AUTH_MODE: "local",
    },
    pool: "forks",
    // Every integration file runs `prisma db push` against its own SQLite
    // database. Vitest 4 ignores the legacy `forks.singleFork` option, which
    // let hooks race on Prisma's engines and made the suite nondeterministic.
    fileParallelism: false,
    minWorkers: 1,
    maxWorkers: 1,
  },
});
