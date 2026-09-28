import { describe, expect, it } from "vitest";
import { scoreDocuments, scoreField } from "./document-scoring.js";
import type {
  DocumentLabel,
  DocumentResult,
  ExtractedField,
  FieldLabel,
} from "./document-scoring.js";
import type { FieldType, FieldValue } from "./field-values.js";

function label(
  condition: FieldLabel["condition"],
  type: FieldType = "text",
  value: FieldValue = "expected",
): FieldLabel {
  return {
    type,
    script: "arabic",
    condition,
    value,
    decoy: { value: type === "money" ? "500" : "2026-01-12" },
  };
}

function result(
  doc_id: string,
  values: Readonly<Record<string, FieldValue>>,
  candidateId = "a",
): DocumentResult {
  return {
    candidateId,
    doc_id,
    status: "ok",
    output: {
      fields: Object.fromEntries(
        Object.entries(values).map(
          ([field, value]): [string, ExtractedField] => [
            field,
            {
              value,
              evidence: null,
              null_reason: value === null ? "absent" : null,
            },
          ],
        ),
      ),
    },
  };
}

describe("scoreDocuments", () => {
  it("scores every outcome", () => {
    const document: DocumentLabel = {
      doc_id: "doc-1",
      kind: "contract",
      fields: {
        correct: label("readable"),
        incorrect: label("readable"),
        missing: label("readable"),
        absentAbstained: label("absent"),
        absentFilled: label("absent", "money", null),
        occludedAbstained: label("occluded"),
        occludedFilled: label("occluded", "id_number", null),
        distractorAbstained: label("distractor"),
        distractorCaptured: label("distractor", "date", null),
        distractorOther: label("distractor", "money", null),
      },
    };
    const [score] = scoreDocuments(
      [document],
      [
        result("doc-1", {
          correct: "expected",
          incorrect: "wrong",
          missing: null,
          absentAbstained: "",
          absentFilled: "AED 42",
          occludedAbstained: null,
          occludedFilled: "٧٨٤",
          distractorAbstained: " ",
          distractorCaptured: "12 Jan 2026",
          distractorOther: "600",
        }),
      ],
    );
    if (score === undefined) throw new Error("Expected one candidate score.");
    expect(score).toMatchObject({
      candidateId: "a",
      documents: 1,
      schemaValidDocuments: 1,
      readableFields: 3,
      correct: 1,
      incorrect: 1,
      missing: 1,
      unavailableFields: 4,
      unsupportedFills: 2,
      distractorFields: 3,
      distractorCaptures: 1,
      distractorOtherFills: 1,
      exactDocuments: 0,
    });
    expect(score.fieldAccuracy).toEqual({
      estimate: 1 / 3,
      lower: 1 / 3,
      upper: 1 / 3,
    });
    expect(score.missingFieldRate?.estimate).toBe(1 / 3);
    expect(score.incorrectRate?.estimate).toBe(1 / 3);
    expect(score.unsupportedFillRate?.estimate).toBe(1 / 2);
    expect(score.distractorCaptureRate?.estimate).toBe(1 / 3);
    expect(score.exactDocumentRate?.estimate).toBe(0);
    expect(score.schemaValidRate?.estimate).toBe(1);
    expect(score.perFieldAccuracy.correct?.estimate).toBe(1);
    expect(score.perFieldAccuracy.incorrect?.estimate).toBe(0);
    expect(score.perFieldAccuracy.missing?.estimate).toBe(0);
    expect(score.arabicScriptFieldAccuracy?.estimate).toBe(1 / 3);
    expect(score.perKindFieldAccuracy.contract?.estimate).toBe(1 / 3);
    expect(score.fabrications).toEqual([
      { doc_id: "doc-1", field: "absentFilled", value: "AED 42" },
      { doc_id: "doc-1", field: "occludedFilled", value: "٧٨٤" },
      { doc_id: "doc-1", field: "distractorCaptured", value: "12 Jan 2026" },
      { doc_id: "doc-1", field: "distractorOther", value: "600" },
    ]);
  });
  it("counts missing fields and failed schemas as missing readable fields", () => {
    const documents: readonly DocumentLabel[] = ["a", "b", "c"].map(
      (doc_id) => ({
        doc_id,
        kind: "id",
        fields: { name: label("readable"), absent: label("absent") },
      }),
    );
    const [score] = scoreDocuments(documents, [
      result("a", {}),
      {
        ...result("b", { name: "expected", absent: "invented" }),
        status: "invalid",
      },
      { candidateId: "a", doc_id: "c", status: "ok", output: null },
    ]);
    expect(score).toMatchObject({
      documents: 3,
      schemaValidDocuments: 1,
      missing: 3,
      exactDocuments: 0,
      unsupportedFills: 1,
    });
    expect(score?.schemaValidRate?.estimate).toBe(1 / 3);
  });
  it("retains unsupported fills and fabrications even when the schema failed", () => {
    const document: DocumentLabel = {
      doc_id: "invalid",
      kind: "lease",
      fields: {
        rent: label("absent", "money", null),
        date: label("distractor", "date", null),
      },
    };
    const [score] = scoreDocuments(
      [document],
      [
        {
          ...result("invalid", { rent: "500", date: "12 Jan 2026" }),
          status: "schema_error",
        },
      ],
    );
    expect(score).toMatchObject({
      schemaValidDocuments: 0,
      unsupportedFills: 1,
      distractorCaptures: 1,
      exactDocuments: 0,
    });
    expect(score?.fabrications).toEqual([
      { doc_id: "invalid", field: "rent", value: "500" },
      { doc_id: "invalid", field: "date", value: "12 Jan 2026" },
    ]);
  });
  it("requires empty unavailable and distractor fields for exact documents", () => {
    const document: DocumentLabel = {
      doc_id: "1",
      kind: "id",
      fields: {
        name: label("readable"),
        hidden: label("occluded"),
        decoy: label("distractor"),
      },
    };
    const [score] = scoreDocuments(
      [document],
      [result("1", { name: "expected" })],
    );
    expect(score?.exactDocuments).toBe(1);
  });
  it("pools unequal document sizes and separates candidates, kinds and scripts", () => {
    const documents: readonly DocumentLabel[] = [
      { doc_id: "1", kind: "id", fields: { name: label("readable") } },
      {
        doc_id: "2",
        kind: "contract",
        fields: {
          name: { ...label("readable"), script: "latin" },
          rent: { ...label("readable"), script: "neutral" },
        },
      },
    ];
    const scores = scoreDocuments(documents, [
      result("1", { name: "expected" }),
      result("2", { name: "wrong" }),
      result("1", {}, "b"),
      result("2", {}, "b"),
    ]);
    expect(scores[0]?.fieldAccuracy?.estimate).toBe(1 / 3);
    expect(scores[0]?.arabicScriptFieldAccuracy?.estimate).toBe(1);
    expect(scores[0]?.perKindFieldAccuracy.id?.estimate).toBe(1);
    expect(scores[0]?.perKindFieldAccuracy.contract?.estimate).toBe(0);
    expect(scores[1]?.missing).toBe(3);
  });
  it("rejects missing, duplicate and unknown result ids", () => {
    const documents: readonly DocumentLabel[] = ["1", "2"].map((doc_id) => ({
      doc_id,
      kind: "id",
      fields: {},
    }));
    expect(() => scoreDocuments(documents, [])).toThrow("Missing");
    expect(() => scoreDocuments(documents, [result("1", {})])).toThrow(
      "Missing result",
    );
    expect(() =>
      scoreDocuments(documents, [result("1", {}), result("1", {})]),
    ).toThrow("Duplicate");
    expect(() => scoreDocuments(documents, [result("3", {})])).toThrow(
      "Unexpected",
    );
    expect(() => scoreDocuments([...documents, ...documents], [])).toThrow(
      "unique",
    );
  });
  it("returns undefined rates for no readable or unavailable fields", () => {
    const [score] = scoreDocuments(
      [{ doc_id: "1", kind: "empty", fields: {} }],
      [result("1", {})],
    );
    expect(score?.fieldAccuracy).toBeNull();
    expect(score?.unsupportedFillRate).toBeNull();
    expect(score?.distractorCaptureRate).toBeNull();
    expect(score?.exactDocuments).toBe(1);
    expect(scoreDocuments([], [])).toEqual([]);
  });
  it("treats unparseable nonempty values and zero as fills", () => {
    expect(scoreField(label("absent", "money"), "bad")).toBe(
      "unsupported_fill",
    );
    expect(scoreField(label("absent", "money"), 0)).toBe("unsupported_fill");
    expect(scoreField({ ...label("distractor"), decoy: null }, "wrong")).toBe(
      "unsupported_fill",
    );
  });
});
