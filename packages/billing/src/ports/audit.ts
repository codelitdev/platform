export type AuditActor = {
    kind: "user" | "system" | "operator";
    id: string;
};

export type AuditRecord = {
    effectId: string;
    actor: AuditActor;
    reason?: string;
    previous: unknown;
    next: unknown;
    correlationIds: Record<string, string>;
};

export interface BillingAuditHook {
    record(event: AuditRecord): Promise<void>;
}

export class MemoryAuditHook implements BillingAuditHook {
    readonly records: AuditRecord[] = [];

    async record(event: AuditRecord): Promise<void> {
        if (this.records.some((row) => row.effectId === event.effectId)) return;
        this.records.push(event);
    }
}
