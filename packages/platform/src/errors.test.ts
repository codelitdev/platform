import { describe, expect, it, vi } from "vitest";
import {
    PLATFORM_ERROR_CODES,
    PLATFORM_ERROR_HTTP_STATUS,
    PLATFORM_ERROR_MESSAGES,
    captureAndMapException,
    createPlatformError,
    mapThrownException,
    toPublicHttpError,
} from "./errors.js";

describe("platform errors", () => {
    it("maps every PlatformErrorCode used by HTTP", () => {
        expect(PLATFORM_ERROR_CODES).toEqual([
            "unauthenticated",
            "credential_ambiguous",
            "tenant_required",
            "tenant_forbidden",
            "forbidden",
            "not_found",
            "conflict",
            "validation_failed",
            "rate_limited",
            "internal_error",
        ]);
        for (const code of PLATFORM_ERROR_CODES) {
            const publicError = toPublicHttpError(createPlatformError(code));
            expect(publicError.status).toBe(PLATFORM_ERROR_HTTP_STATUS[code]);
            expect(publicError.body.code).toBe(code);
            expect(publicError.body.message).toBe(PLATFORM_ERROR_MESSAGES[code]);
            expect(JSON.stringify(publicError)).not.toContain("cause");
        }
    });

    it("never derives message from cause", () => {
        const error = createPlatformError("validation_failed", {
            cause: new Error("password=hunter2 connection failed"),
            safeDetails: { field: "name" },
        });
        expect(error.message).toBe(PLATFORM_ERROR_MESSAGES.validation_failed);
        expect(error.message).not.toContain("hunter2");
        const http = toPublicHttpError(error);
        expect(http.body.message).toBe(PLATFORM_ERROR_MESSAGES.validation_failed);
        expect(http.body.details).toEqual({ field: "name" });
        expect(JSON.stringify(http.body)).not.toContain("hunter2");
        expect("cause" in http.body).toBe(false);
    });

    it("maps thrown exceptions to internal_error without leaking cause", () => {
        const thrown = new Error("ECONNREFUSED secret=abc");
        const mapped = mapThrownException(thrown);
        expect(mapped.code).toBe("internal_error");
        expect(mapped.message).toBe(PLATFORM_ERROR_MESSAGES.internal_error);
        expect(mapped.message).not.toContain("ECONNREFUSED");
        expect(mapped.cause).toBe(thrown);
        const http = toPublicHttpError(mapped);
        expect(http.status).toBe(500);
        expect(http.body.message).not.toContain("ECONNREFUSED");
        expect(JSON.stringify(http.body)).not.toContain("secret=abc");
    });

    it("maps a thrown PlatformError to internal_error rather than preserving the code", () => {
        const thrown = createPlatformError("forbidden", {
            cause: "do-not-leak",
        });
        const mapped = mapThrownException(thrown);
        expect(mapped.code).toBe("internal_error");
        expect(mapped.message).toBe(PLATFORM_ERROR_MESSAGES.internal_error);
        expect(toPublicHttpError(mapped).body.message).not.toContain("do-not-leak");
    });

    it("captures then maps even if capture throws", () => {
        const capture = vi.fn(() => {
            throw new Error("capture failed: token=leak");
        });
        const mapped = captureAndMapException(new Error("boom"), capture);
        expect(capture).toHaveBeenCalledTimes(1);
        expect(mapped.code).toBe("internal_error");
        expect(mapped.message).not.toContain("leak");
        expect(mapped.message).not.toContain("boom");
    });
});
