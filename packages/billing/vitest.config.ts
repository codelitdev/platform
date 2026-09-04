import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["src/**/*.test.ts", "examples/**/*.test.ts"],
        environment: "node",
        // PGlite tests share process-level WASM postgres startup cost and
        // some files mutate clock/adapter state; keep files sequential.
        fileParallelism: false,
        testTimeout: 60000,
        hookTimeout: 60000,
    },
});
