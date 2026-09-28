import { createHash } from "node:crypto";
import { z } from "zod";

/** Hash bytes or UTF-8 text without retaining the source. */
export function sha256Hex(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Serialize JSON with sorted object keys and no insignificant whitespace. */
export function canonicalJson(value: unknown): string {
  const parsed = z.json().safeParse(value);
  if (!parsed.success) throw new TypeError("Expected JSON-compatible data");
  return encode(parsed.data);
}

function encode(value: z.infer<ReturnType<typeof z.json>>): string {
  if (Array.isArray(value)) return `[${value.map(encode).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${encode(value[key] ?? null)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
