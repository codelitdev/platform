/** UTC ISO-8601 with milliseconds. */
export function serializeDate(value: Date): string {
    return value.toISOString();
}

export function parseDate(value: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error("date_invalid");
    }
    return parsed;
}

export function serializeDatesDeep(value: unknown): unknown {
    if (value instanceof Date) return serializeDate(value);
    if (Array.isArray(value)) return value.map(serializeDatesDeep);
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [key, nested] of Object.entries(value)) {
            out[key] = serializeDatesDeep(nested);
        }
        return out;
    }
    return value;
}
