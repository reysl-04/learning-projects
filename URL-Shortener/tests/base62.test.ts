import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeBase62, encodeBase62 } from "../src/lib/base62.ts";
import { randomCode } from "../src/lib/codes.ts";

test("base62 round-trips boundary values", () => {
  const values = [0, 1, 61, 62, 63, 3843, 3844, 123_456_789, 3_521_614_606_207n];
  for (const value of values) {
    const encoded = encodeBase62(value);
    assert.equal(decodeBase62(encoded), BigInt(value), `round-trip failed for ${value}`);
  }
});

test("base62 uses the documented alphabet and widths", () => {
  assert.equal(encodeBase62(0), "0");
  assert.equal(encodeBase62(61), "z");
  assert.equal(encodeBase62(62), "10");
  assert.equal(encodeBase62(3_521_614_606_207n).length, 7);
});

test("base62 rejects bad input", () => {
  assert.throws(() => encodeBase62(-1));
  assert.throws(() => decodeBase62(""));
  assert.throws(() => decodeBase62("abc!"));
});

test("random codes are URL-safe and the requested length", () => {
  for (let i = 0; i < 200; i += 1) {
    const code = randomCode(7);
    assert.match(code, /^[0-9A-Za-z]{7}$/);
  }
});
