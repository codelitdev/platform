/** Injected time source. Core decision functions never read wall time. */
export type Clock = {
    now(): Date;
};

export const systemClock: Clock = {
    now(): Date {
        return new Date();
    },
};

export function frozenClock(at: Date): Clock {
    const ms = at.getTime();
    return {
        now(): Date {
            return new Date(ms);
        },
    };
}

export function advancingClock(
    start: Date,
    stepMs = 0,
): Clock & { tick(ms?: number): Date } {
    let ms = start.getTime();
    return {
        now(): Date {
            return new Date(ms);
        },
        tick(delta = stepMs): Date {
            ms += delta;
            return new Date(ms);
        },
    };
}
