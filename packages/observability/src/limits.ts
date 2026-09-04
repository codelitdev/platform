export type Clock = { now(): Date };

export function createDedupe(options: {
    ttlMs: number;
    maxKeys: number;
    clock: Clock;
}) {
    const fingerprints = new Map<string, number>();
    return {
        shouldSkip(fingerprint: string): boolean {
            const now = options.clock.now().getTime();
            const expiry = fingerprints.get(fingerprint);
            if (expiry && expiry > now) return true;
            if (fingerprints.size >= options.maxKeys) fingerprints.clear();
            fingerprints.set(fingerprint, now + options.ttlMs);
            return false;
        },
        size(): number {
            return fingerprints.size;
        },
    };
}

export function createSourceCap(options: { perSource: number; clock: Clock }) {
    const windows = new Map<string, { minute: number; count: number }>();
    return {
        isLimited(source: string): boolean {
            const minute = Math.floor(options.clock.now().getTime() / 60_000);
            const current = windows.get(source);
            if (!current || current.minute !== minute) {
                windows.set(source, { minute, count: 1 });
                return false;
            }
            if (current.count >= options.perSource) return true;
            current.count += 1;
            return false;
        },
    };
}
