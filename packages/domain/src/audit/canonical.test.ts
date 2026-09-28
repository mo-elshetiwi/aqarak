import { describe, it, expect } from "vitest";
import { z } from "zod";
import fc from "fast-check";
import fixture from "../../fixtures/audit/canon-v1.json";
import {
  CANON_VERSION,
  GENESIS_PREV_HASH,
  encodeCanonical,
  sha256Hex,
  computeRowHash,
  type CanonicalValue,
} from "./index";

describe("AQ-CANON-1 encoding", () => {
  it.each(fixture.encoding_cases)(
    "matches the fixture for $name",
    ({ input_json, expected_text }) => {
      expect(encodeCanonical(z.json().parse(JSON.parse(input_json)))).toBe(
        expected_text,
      );
    },
  );

  it("identifies the synthetic fixture and genesis contract", () => {
    expect(fixture.synthetic).toBe(true);
    expect(fixture.encoding_cases.some((c) => c.input_json === "1.50")).toBe(
      true,
    );
    expect(fixture.description).toContain("Synthetic test data for AQ-CANON-1");
    expect(fixture.canon_version).toBe(CANON_VERSION);
    expect(fixture.genesis_prev_hash).toBe(GENESIS_PREV_HASH);
    expect(fixture.encoding_cases.length).toBeGreaterThanOrEqual(14);
  });

  it("ignores object insertion order at every depth", () => {
    expect(encodeCanonical({ z: { b: 2, a: 1 }, a: null })).toBe(
      encodeCanonical({ a: null, z: { a: 1, b: 2 } }),
    );
  });

  it.each(["Amount-Fils", "_amount", "2amount", "مبلغ", "", "a b", "a\n"])(
    "rejects invalid key %j by name",
    (key) => {
      expect(() => encodeCanonical({ [key]: 1 })).toThrow(
        new TypeError(`Invalid canonical key: ${key}`),
      );
    },
  );

  it("rejects an undefined property and names it", () => {
    const value: Record<string, CanonicalValue> = {};
    Object.defineProperty(value, "missing", {
      value: undefined,
      enumerable: true,
    });
    expect(() => encodeCanonical(value)).toThrow(
      new TypeError("Canonical property must not be undefined: missing"),
    );
  });

  it.each([NaN, Infinity, -Infinity, 2 ** 53, -(2 ** 53), 1e21])(
    "rejects non-finite or unsafe number %s",
    (value) => {
      expect(() => encodeCanonical(value)).toThrow(RangeError);
    },
  );

  it.each(["\uD800", "\uDC00", "x\uD800y"])(
    "rejects ill-formed string %j",
    (value) => {
      expect(() => encodeCanonical(value)).toThrow(TypeError);
    },
  );

  it.each([
    [Number.MIN_VALUE, `"0.${"0".repeat(323)}5"`],
    [-1.234e-7, '"-0.0000001234"'],
    [Number.MAX_SAFE_INTEGER, '"9007199254740991"'],
    [Number.MIN_SAFE_INTEGER, '"-9007199254740991"'],
    [0.000001, '"0.000001"'],
    [1.2345678901234567, '"1.2345678901234567"'],
  ] as const)("preserves the shortest decimal for %s", (value, expected) => {
    expect(encodeCanonical(value)).toBe(expected);
  });

  it.each([
    undefined,
    1n,
    Symbol("synthetic"),
    () => null,
    new Date("2026-09-28T00:00:00Z"),
    new Map(),
    new Array<CanonicalValue>(1),
  ])("rejects unsupported runtime value %#", (value) => {
    expect(() => {
      Reflect.apply(encodeCanonical, null, [value]);
    }).toThrow(TypeError);
  });

  it("encodes non-enumerable stored properties instead of silently dropping them", () => {
    const value: Record<string, CanonicalValue> = {};
    Object.defineProperty(value, "amount", { value: 1 });
    expect(encodeCanonical(value)).toBe('{"amount":"1"}');
  });

  it("rejects cyclic records", () => {
    const value: Record<string, CanonicalValue> = {};
    value.self = value;
    expect(() => encodeCanonical(value)).toThrow(TypeError);
  });

  it("accepts shared acyclic records", () => {
    const value = { a: 1 };
    expect(encodeCanonical([value, value])).toBe('[{"a":"1"},{"a":"1"}]');
  });

  it("accepts records with a null prototype", () => {
    const value = { a: 1 };
    Object.setPrototypeOf(value, null);
    expect(encodeCanonical(value)).toBe('{"a":"1"}');
  });

  it("rejects symbol keys instead of omitting data", () => {
    const value = { [Symbol("synthetic")]: 1 };
    expect(() => encodeCanonical(value)).toThrow(TypeError);
  });

  it("rejects accessors without invoking them", () => {
    const value: Record<string, CanonicalValue> = {};
    Object.defineProperty(value, "a", {
      enumerable: true,
      get() {
        throw new Error("Accessor must not run");
      },
    });
    expect(() => encodeCanonical(value)).toThrow(
      new TypeError("Canonical property must store a value: a"),
    );
  });

  it("leaves frozen values unchanged", () => {
    const value = Object.freeze({ b: Object.freeze([2, 1]), a: null });
    expect(encodeCanonical(value)).toBe('{"a":null,"b":["2","1"]}');
    expect(Object.keys(value)).toEqual(["b", "a"]);
  });

  it("round-trips finite safe decimals without exponent notation", () => {
    fc.assert(
      fc.property(
        fc
          .double({ noNaN: true, noDefaultInfinity: true })
          .filter(
            (value) => !Number.isInteger(value) || Number.isSafeInteger(value),
          ),
        (value) => {
          const encoded = encodeCanonical(value);
          expect(encoded).toMatch(/^"-?(?:0|[1-9]\d*)(?:\.\d*[1-9])?"$/);
          expect(Number(encoded.slice(1, -1))).toBe(value === 0 ? 0 : value);
        },
      ),
      // The constrained build caps properties at 100 cases while retaining the seed.
      { seed: 20303, numRuns: 100 },
    );
  }, 60_000);
});

describe("SHA-256 audit hashing", () => {
  it.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    [
      "عقار",
      "0d221bda77daffc8a19f1403b3d03e68923a1ba76f2f75e7b1a49fe5773b94a1",
    ],
  ])("matches the independent SHA-256 answer for %j", (input, expected) => {
    expect(sha256Hex(input)).toBe(expected);
  });

  it("matches the independent row hash answer", () => {
    expect(
      computeRowHash({
        prevHash: GENESIS_PREV_HASH,
        canonVersion: CANON_VERSION,
        canonicalText: '{"amount_fils":"150000","note":"عقد","rate":"1.5"}',
      }),
    ).toBe("0ba068deed33b80852212dcff4dfe9c1a21d2be6068ce4d9b6a056e391ae5995");
  });

  it.each(["a".repeat(63), "a".repeat(65), "A".repeat(64), "g".repeat(64), ""])(
    "rejects malformed previous hash %j",
    (prevHash) => {
      expect(() =>
        computeRowHash({
          prevHash,
          canonVersion: CANON_VERSION,
          canonicalText: "null",
        }),
      ).toThrow(TypeError);
    },
  );

  it("rejects ill-formed text before UTF-8 hashing", () => {
    expect(() => sha256Hex("\uD800")).toThrow(TypeError);
  });
});
