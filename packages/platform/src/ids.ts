import type { Clock } from "./clock.js";
import { systemClock } from "./clock.js";

const UUID_HEX = /^[0-9a-f]{32}$/;
const PREFIX = /^[a-z][a-z0-9]{0,15}$/;

export type RandomBytes = (size: number) => Uint8Array;

const defaultRandom: RandomBytes = (size) =>
  crypto.getRandomValues(new Uint8Array(size));

function byteToHex(byte: number): string {
  return byte.toString(16).padStart(2, "0");
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, byteToHex).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** RFC 9562 UUIDv7. Version and variant bits are always set. */
export function uuidv7(
  clock: Clock = systemClock,
  random: RandomBytes = defaultRandom,
): string {
  const bytes = random(16);
  if (bytes.length < 16) {
    throw new Error("random_bytes_short");
  }
  const timestamp = BigInt(clock.now().getTime());
  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[7] = bytes[7]!;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return bytesToUuid(bytes);
}

export function uuidv7Hex(
  clock: Clock = systemClock,
  random: RandomBytes = defaultRandom,
): string {
  return uuidv7(clock, random).replaceAll("-", "");
}

export function createPublicId(
  prefix: string,
  clock: Clock = systemClock,
  random: RandomBytes = defaultRandom,
): string {
  if (!PREFIX.test(prefix)) {
    throw new Error("public_id_prefix_invalid");
  }
  return `${prefix}_${uuidv7Hex(clock, random)}`;
}

export function parsePublicId(
  value: string,
  expectedPrefix?: string,
): { prefix: string; uuidHex: string } {
  const sep = value.indexOf("_");
  if (sep <= 0) {
    throw new Error("public_id_invalid");
  }
  const prefix = value.slice(0, sep);
  const uuidHex = value.slice(sep + 1);
  if (!PREFIX.test(prefix) || !UUID_HEX.test(uuidHex)) {
    throw new Error("public_id_invalid");
  }
  if (expectedPrefix !== undefined && prefix !== expectedPrefix) {
    throw new Error("public_id_prefix_mismatch");
  }
  return { prefix, uuidHex };
}

export function createRequestId(
  clock: Clock = systemClock,
  random: RandomBytes = defaultRandom,
): string {
  return uuidv7(clock, random);
}

export function readOrCreateRequestId(
  header: string | undefined,
  clock: Clock = systemClock,
  random: RandomBytes = defaultRandom,
): string {
  if (typeof header === "string" && header.trim().length > 0) {
    return header.trim().slice(0, 128);
  }
  return createRequestId(clock, random);
}
