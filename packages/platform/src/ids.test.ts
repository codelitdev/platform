import { describe, expect, it } from "vitest";
import { frozenClock } from "./clock.js";
import {
    createPublicId,
    createRequestId,
    parsePublicId,
    readOrCreateRequestId,
    uuidv7,
} from "./ids.js";

describe("ids", () => {
    it("emits RFC 9562 version 7 UUIDs", () => {
        const clock = frozenClock(new Date("2026-01-15T12:00:00.000Z"));
        const random = () => new Uint8Array(16).fill(0x11);
        const id = uuidv7(clock, random);
        expect(id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        const again = uuidv7(clock, random);
        expect(again).toBe(id);
    });

    it("builds and parses prefixed public ids", () => {
        const clock = frozenClock(new Date("2026-01-15T12:00:00.000Z"));
        const random = () => new Uint8Array(16).fill(0x22);
        const publicId = createPublicId("tnt", clock, random);
        expect(publicId.startsWith("tnt_")).toBe(true);
        const parsed = parsePublicId(publicId, "tnt");
        expect(parsed.prefix).toBe("tnt");
        expect(parsed.uuidHex).toHaveLength(32);
        expect(() => parsePublicId(publicId, "ws")).toThrow("public_id_prefix_mismatch");
    });

    it("creates a request id when the correlation header is absent", () => {
        const clock = frozenClock(new Date("2026-01-15T12:00:00.000Z"));
        const random = () => new Uint8Array(16).fill(0x33);
        expect(readOrCreateRequestId(undefined, clock, random)).toBe(
            createRequestId(clock, random),
        );
        expect(readOrCreateRequestId(" req-abc ", clock, random)).toBe("req-abc");
    });
});
