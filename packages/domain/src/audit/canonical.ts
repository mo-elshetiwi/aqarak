import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

/** Identifies the canonical encoding persisted alongside each audit row. */
export const CANON_VERSION = "AQ-CANON-1";

/** Supplies the previous hash when starting a company's audit chain. */
export const GENESIS_PREV_HASH = "0".repeat(64);

/** Describes the JSON-compatible values accepted by the canonical encoder. */
export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

function escapeCharacter(character: string): string {
  switch (character) {
    case '"':
      return '\\"';
    case "\\":
      return "\\\\";
    case "\b":
      return "\\b";
    case "\f":
      return "\\f";
    case "\n":
      return "\\n";
    case "\r":
      return "\\r";
    case "\t":
      return "\\t";
    default:
      return `\\u00${character.charCodeAt(0).toString(16).padStart(2, "0")}`;
  }
}

function quotedString(value: string): string {
  if (!value.isWellFormed()) {
    throw new TypeError("Canonical strings must not contain lone surrogates");
  }
  const escaped = Array.from(value, (character) =>
    character.charCodeAt(0) < 32 || character === '"' || character === "\\"
      ? escapeCharacter(character)
      : character,
  ).join("");
  return `"${escaped}"`;
}

function decimalText(value: number): string {
  if (!Number.isFinite(value)) {
    throw new RangeError("Canonical numbers must be finite");
  }
  if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
    throw new RangeError("Canonical integers must be safe integers");
  }
  const text = String(value);
  if (!text.includes("e")) return text;
  const [mantissa = "", exponent = "0"] = text.split("e");
  const sign = value < 0 ? "-" : "";
  const unsigned = mantissa.replace("-", "");
  const digits = unsigned.replace(".", "");
  const point = unsigned.indexOf(".");
  const position = (point < 0 ? unsigned.length : point) + Number(exponent);
  // Exponential forms that survive the safe-integer check are smaller than one.
  return `${sign}0.${"0".repeat(-position)}${digits}`;
}

function encodeObject(value: object, ancestors: Set<object>): string {
  if (ancestors.has(value)) {
    throw new TypeError("Canonical values must not contain cycles");
  }
  ancestors.add(value);
  let encoded: string;
  if (Array.isArray(value)) {
    const values: readonly unknown[] = value;
    encoded = `[${Array.from(values, (entry) => encodeValue(entry, ancestors)).join(",")}]`;
  } else {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical objects must be plain records");
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError("Canonical object keys must be ASCII identifiers");
    }
    encoded = `{${Object.getOwnPropertyNames(value)
      .sort()
      .map((key) => {
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) {
          throw new TypeError(`Invalid canonical key: ${key}`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !("value" in descriptor)) {
          throw new TypeError(`Canonical property must store a value: ${key}`);
        }
        if (descriptor.value === undefined) {
          throw new TypeError(
            `Canonical property must not be undefined: ${key}`,
          );
        }
        return `${quotedString(key)}:${encodeValue(descriptor.value, ancestors)}`;
      })
      .join(",")}}`;
  }
  ancestors.delete(value);
  return encoded;
}

function encodeValue(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string") return quotedString(value);
  if (typeof value === "number") return quotedString(decimalText(value));
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return encodeObject(value, ancestors);
  throw new TypeError(`Unsupported canonical value: ${typeof value}`);
}

/** Encodes an audit value with AQ-CANON-1 for hashing or cross-platform comparison.
 * Numeric 1 and the string "1" encode identically by design; callers validate types first.
 * @throws {TypeError} If strings, keys, containers or value types are malformed.
 * @throws {RangeError} If a number is non-finite or an unsafe integer.
 */
export function encodeCanonical(value: CanonicalValue): string {
  return encodeValue(value, new Set());
}

/** Hashes well-formed text as UTF-8 when a lowercase SHA-256 digest is needed.
 * @throws {TypeError} If text contains a lone surrogate.
 */
export function sha256Hex(text: string): string {
  if (!text.isWellFormed()) {
    throw new TypeError("Hash input must be well-formed Unicode");
  }
  return bytesToHex(sha256(utf8ToBytes(text)));
}

/** Hashes a canonical audit row with its previous hash and encoding version.
 * @throws {TypeError} If the previous hash is not lowercase SHA-256 hex or text is malformed.
 */
export function computeRowHash(input: {
  readonly prevHash: string;
  readonly canonVersion: string;
  readonly canonicalText: string;
}): string {
  if (!/^[0-9a-f]{64}$/.test(input.prevHash)) {
    throw new TypeError(
      "Previous hash must contain 64 lowercase hex characters",
    );
  }
  return sha256Hex(
    `${input.prevHash}|${input.canonVersion}|${input.canonicalText}`,
  );
}
