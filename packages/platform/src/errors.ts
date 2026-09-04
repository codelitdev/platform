export type PlatformErrorCode =
    | "unauthenticated"
    | "credential_ambiguous"
    | "tenant_required"
    | "tenant_forbidden"
    | "forbidden"
    | "not_found"
    | "conflict"
    | "validation_failed"
    | "rate_limited"
    | "internal_error";

export const PLATFORM_ERROR_CODES: readonly PlatformErrorCode[] = [
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
];

export const PLATFORM_ERROR_MESSAGES: Record<PlatformErrorCode, string> = {
    unauthenticated: "Authentication is required.",
    credential_ambiguous: "Exactly one credential mechanism is allowed.",
    tenant_required: "A tenant must be selected.",
    tenant_forbidden: "The selected tenant is not accessible.",
    forbidden: "The requested action is not permitted.",
    not_found: "The requested resource was not found.",
    conflict: "The request conflicts with current state.",
    validation_failed: "The request is invalid.",
    rate_limited: "The request was rate limited.",
    internal_error: "An internal error occurred.",
};

export const PLATFORM_ERROR_HTTP_STATUS: Record<PlatformErrorCode, number> = {
    unauthenticated: 401,
    credential_ambiguous: 400,
    tenant_required: 400,
    tenant_forbidden: 403,
    forbidden: 403,
    not_found: 404,
    conflict: 409,
    validation_failed: 400,
    rate_limited: 429,
    internal_error: 500,
};

export type PlatformSafeDetails = Readonly<
    Record<string, string | number | boolean | null>
>;

export interface PlatformError {
    code: PlatformErrorCode;
    message: string;
    safeDetails?: PlatformSafeDetails;
    cause?: unknown;
}

export function isPlatformError(value: unknown): value is PlatformError {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as { code?: unknown; message?: unknown };
    return (
        typeof candidate.code === "string" &&
        (PLATFORM_ERROR_CODES as readonly string[]).includes(candidate.code) &&
        typeof candidate.message === "string"
    );
}

export function createPlatformError(
    code: PlatformErrorCode,
    options: { safeDetails?: PlatformSafeDetails; cause?: unknown } = {},
): PlatformError {
    const error: PlatformError = {
        code,
        message: PLATFORM_ERROR_MESSAGES[code],
    };
    if (options.safeDetails) error.safeDetails = options.safeDetails;
    if (options.cause !== undefined) error.cause = options.cause;
    return error;
}

/**
 * Thrown exceptions always become `internal_error`. The public `message` is
 * never derived from `cause` or from a thrown PlatformError.
 */
export function mapThrownException(thrown: unknown): PlatformError {
    return createPlatformError("internal_error", { cause: thrown });
}

export function captureAndMapException(
    thrown: unknown,
    capture?: (error: unknown) => void,
): PlatformError {
    try {
        capture?.(thrown);
    } catch {
        // Capture must not change the mapped error or fail the request.
    }
    return mapThrownException(thrown);
}

export type PublicErrorBody = {
    code: PlatformErrorCode;
    message: string;
    details?: PlatformSafeDetails;
};

export type PublicHttpError = {
    status: number;
    body: PublicErrorBody;
};

export function toPublicErrorBody(error: PlatformError): PublicErrorBody {
    const body: PublicErrorBody = {
        code: error.code,
        message: PLATFORM_ERROR_MESSAGES[error.code],
    };
    if (error.safeDetails) body.details = error.safeDetails;
    return body;
}

export function toPublicHttpError(error: PlatformError): PublicHttpError {
    return {
        status: PLATFORM_ERROR_HTTP_STATUS[error.code],
        body: toPublicErrorBody(error),
    };
}
