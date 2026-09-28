import { describe, expect, it } from "vitest";
import { z } from "zod";
import { decodeJsonColumn } from "./database-json";

describe("Data API JSONB boundary", () => {
  it("decodes text before validating stored responses and rejects extra keys", () => {
    const schema = z.preprocess(
      decodeJsonColumn,
      z.strictObject({
        status: z.literal(200),
        body: z.strictObject({ ok: z.boolean() }),
      }),
    );
    expect(schema.parse('{"status":200,"body":{"ok":true}}')).toEqual({
      status: 200,
      body: { ok: true },
    });
    expect(() =>
      schema.parse('{"status":200,"body":{"ok":true},"extra":1}'),
    ).toThrow();
  });
  it("also accepts decoded JSONB and rejects malformed text", () => {
    expect(decodeJsonColumn({ value: "عقار" })).toEqual({ value: "عقار" });
    expect(decodeJsonColumn(null)).toBeNull();
    expect(() => decodeJsonColumn("invalid JSON")).toThrow();
  });
});
