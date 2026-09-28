import { expect, it } from "vitest";
import { canonicalJson, sha256Hex } from "./hashing";
it("canonicalizes keys recursively and hashes UTF-8 consistently", () => {
  expect(canonicalJson({ z: [{ b: 2, a: 1 }], a: null })).toBe(
    '{"a":null,"z":[{"a":1,"b":2}]}',
  );
  expect(sha256Hex("fixture")).toBe(sha256Hex(Buffer.from("fixture")));
  expect(() => canonicalJson(undefined)).toThrow();
});
