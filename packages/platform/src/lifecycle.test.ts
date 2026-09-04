import { describe, expect, it } from "vitest";
import { frozenClock } from "./clock.js";
import {
    createGracefulShutdown,
    healthReport,
    readinessReport,
} from "./lifecycle.js";

describe("lifecycle", () => {
    it("reports health with serialized time", () => {
        const clock = frozenClock(new Date("2026-01-15T12:00:00.000Z"));
        expect(healthReport("reference-api", clock)).toEqual({
            status: "ok",
            service: "reference-api",
            time: "2026-01-15T12:00:00.000Z",
        });
    });

    it("is not ready when any check fails", () => {
        expect(
            readinessReport([
                { name: "database", ready: true },
                { name: "migrations", ready: false },
            ]),
        ).toEqual({
            status: "not_ready",
            checks: { database: true, migrations: false },
        });
        expect(readinessReport([{ name: "database", ready: true }])).toEqual({
            status: "ready",
            checks: { database: true },
        });
    });

    it("runs shutdown hooks once and enforces timeout", async () => {
        let calls = 0;
        const shutdown = createGracefulShutdown({
            timeoutMs: 20,
            hooks: [
                async () => {
                    calls += 1;
                },
            ],
        });
        await shutdown.shutdown();
        await shutdown.shutdown();
        expect(calls).toBe(1);
        expect(shutdown.shuttingDown()).toBe(true);

        const hung = createGracefulShutdown({
            timeoutMs: 10,
            hooks: [
                () =>
                    new Promise(() => {
                        /* never settles */
                    }),
            ],
        });
        await expect(hung.shutdown()).rejects.toThrow("shutdown_timeout");
    });
});
