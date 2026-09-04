/** Injected time source. Kernel helpers never read wall time unless given this. */
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
