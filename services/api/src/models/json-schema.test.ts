import { expect, it } from "vitest";
import { z } from "zod";
import { toStrictJsonSchema } from "./json-schema";
import {
  documentExtractionSchemaFor,
  documentKindSchema,
  extractedFieldSchema,
  DOCUMENT_FIELD_CATALOGUE,
} from "./document-extraction";
it("requires every catalogue field with strict nested objects and nullable values", () => {
  for (const kind of documentKindSchema.options) {
    const result = toStrictJsonSchema(documentExtractionSchemaFor(kind), kind);
    const text = JSON.stringify(result.schema);
    expect(text).not.toContain("$schema");
    expect(text).toContain('"anyOf"');
    expect(text).toContain('"type":"null"');
    for (const field of DOCUMENT_FIELD_CATALOGUE[kind])
      expect(text).toContain(field.description);
  }
  expect(() =>
    toStrictJsonSchema(z.looseObject({ value: z.string() }), "test"),
  ).toThrow();
  expect(() =>
    toStrictJsonSchema(
      z.strictObject({ value: z.string().optional() }),
      "test",
    ),
  ).toThrow();
});
it("enforces null reasons, evidence length and strict extraction fields", () => {
  expect(
    extractedFieldSchema.safeParse({
      value: null,
      evidence: null,
      null_reason: "absent",
    }).success,
  ).toBe(true);
  expect(
    extractedFieldSchema.safeParse({
      value: null,
      evidence: null,
      null_reason: null,
    }).success,
  ).toBe(false);
  expect(
    extractedFieldSchema.safeParse({
      value: "test",
      evidence: "a".repeat(81),
      null_reason: null,
    }).success,
  ).toBe(false);
  expect(
    documentExtractionSchemaFor("emirates_id").safeParse({ fields: {} })
      .success,
  ).toBe(false);
});
