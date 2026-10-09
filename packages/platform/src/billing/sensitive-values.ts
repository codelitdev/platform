import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { SensitiveValuePort } from "@codelitdev/billing/workflows";

const ALGORITHM = "aes-256-gcm";
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function parseKey(raw: string, name: string): Buffer {
  if (!BASE64.test(raw)) throw new Error(`${name}_must_be_base64`);
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error(`${name}_must_be_32_bytes`);
  return key;
}

/**
 * AES-256-GCM encryption for the billing engine's stored secrets, such as
 * checkout URLs and webhook payloads. Ciphertext is `iv.tag.ciphertext` in
 * base64. Decryption also tries `previousKeys`, so a key can be rotated
 * without losing stored values.
 */
export function createAesGcmSensitiveValues(options: {
  /** Base64 of 32 random bytes, for example from `openssl rand -base64 32`. */
  key: string;
  previousKeys?: readonly string[];
  keyVersion?: string;
}): SensitiveValuePort {
  const current = parseKey(options.key, "billing_encryption_key");
  const keys = [
    current,
    ...(options.previousKeys ?? []).map((key) => parseKey(key, "billing_previous_key")),
  ];
  const keyVersion = options.keyVersion ?? "v1";
  return {
    async encrypt(plaintext) {
      const iv = randomBytes(12);
      const cipher = createCipheriv(ALGORITHM, current, iv);
      const ciphertext = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ]);
      return {
        ciphertext: [iv, cipher.getAuthTag(), ciphertext]
          .map((part) => part.toString("base64"))
          .join("."),
        keyVersion,
      };
    },
    async decrypt(payload) {
      const [iv, tag, ciphertext] = payload.split(".");
      if (!iv || !tag || !ciphertext) throw new Error("billing_ciphertext_invalid");
      for (const key of keys) {
        try {
          const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64"));
          decipher.setAuthTag(Buffer.from(tag, "base64"));
          return Buffer.concat([
            decipher.update(Buffer.from(ciphertext, "base64")),
            decipher.final(),
          ]).toString("utf8");
        } catch {
          // try the next key
        }
      }
      throw new Error("billing_ciphertext_authentication_failed");
    },
  };
}

/**
 * Reads `BILLING_DATA_ENCRYPTION_KEY` and an optional comma-separated
 * `BILLING_DATA_ENCRYPTION_KEY_PREVIOUS`.
 */
export function aesGcmSensitiveValuesFromEnv(
  env: Record<string, string | undefined> = process.env,
): SensitiveValuePort {
  const key = env.BILLING_DATA_ENCRYPTION_KEY?.trim();
  if (!key) throw new Error("BILLING_DATA_ENCRYPTION_KEY_missing");
  const previousKeys = (env.BILLING_DATA_ENCRYPTION_KEY_PREVIOUS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return createAesGcmSensitiveValues({ key, previousKeys });
}
