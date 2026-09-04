import { createHash } from "node:crypto";
import type { AuditRecord } from "./audit.js";

export interface SensitiveValuePort {
    encrypt(
        plaintext: string,
    ): Promise<{ ciphertext: string; keyVersion: string }>;
    decrypt(
        ciphertext: string,
        context: { operatorActorId: string; reason: string },
    ): Promise<string>;
}

export class MemorySensitiveValuePort implements SensitiveValuePort {
    readonly decrypts: AuditRecord[] = [];

    async encrypt(
        plaintext: string,
    ): Promise<{ ciphertext: string; keyVersion: string }> {
        return { ciphertext: `enc:${plaintext}`, keyVersion: "v1" };
    }

    async decrypt(
        ciphertext: string,
        context: { operatorActorId: string; reason: string },
    ): Promise<string> {
        this.decrypts.push({
            effectId: `decrypt:${createHash("sha256").update(ciphertext, "utf8").digest("hex")}`,
            actor: { kind: "operator", id: context.operatorActorId },
            reason: context.reason,
            previous: null,
            next: null,
            correlationIds: {},
        });
        return ciphertext.startsWith("enc:") ? ciphertext.slice(4) : ciphertext;
    }
}
