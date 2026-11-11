import { randomInt } from "node:crypto";
import { ALPHABET } from "./base62.ts";

/**
 * Random codes are preferred over sequential IDs for public URLs:
 * sequential codes let anyone enumerate every link in the system.
 */
export function randomCode(length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}

/** Codes live in the path segment, so keep them URL-safe and bounded. */
export const CODE_PATTERN = /^[0-9A-Za-z_-]{3,32}$/;

export function isValidCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}

/** Names that must never be handed out as link codes because routes own them. */
export const RESERVED_CODES = new Set([
  "api",
  "health",
  "healthz",
  "admin",
  "stats",
  "favicon.ico",
  "robots.txt",
  "index.html",
]);

export function isReservedCode(code: string): boolean {
  return RESERVED_CODES.has(code.toLowerCase());
}
