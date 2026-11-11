/**
 * Base62 helpers. Used when short codes are derived from an integer
 * (e.g. a database sequence or a Snowflake ID) instead of being random.
 *
 * 62^7 = 3_521_614_606_208, so 7 characters cover ~3.5 trillion IDs.
 */
export const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const BASE = BigInt(ALPHABET.length);

export function encodeBase62(value: bigint | number): string {
  let n = typeof value === "number" ? BigInt(Math.trunc(value)) : value;
  if (n < 0n) throw new RangeError("encodeBase62 only accepts non-negative values");
  if (n === 0n) return "0";

  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % BASE)] + out;
    n /= BASE;
  }
  return out;
}

export function decodeBase62(text: string): bigint {
  if (text.length === 0) throw new Error("decodeBase62 received an empty string");

  let n = 0n;
  for (const char of text) {
    const digit = ALPHABET.indexOf(char);
    if (digit === -1) throw new Error(`Invalid base62 character: "${char}"`);
    n = n * BASE + BigInt(digit);
  }
  return n;
}
