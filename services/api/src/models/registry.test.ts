import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  loadModelRegistry,
  modelRegistrySchema,
  getCandidate,
  registrySha256,
} from "./registry";
import { UnknownCandidateError } from "./errors";
import { fakeRegistry } from "./test-fixtures";
import { canonicalJson, sha256Hex } from "./hashing";
describe("AC-1 registry", () => {
  it("uses the held-out survivors without a model fallback and selects the pre-registered drafting candidate", () => {
    const scores = z
      .object({
        summary: z.array(
          z.object({
            candidate: z.string(),
            screening_decision: z.string(),
          }),
        ),
      })
      .parse(
        JSON.parse(
          readFileSync(
            new URL(
              "../../../../evaluation/results/screening-2026-09-28/mc1_document_extraction/scores.json",
              import.meta.url,
            ),
            "utf8",
          ),
        ),
      );
    const survivors = scores.summary.filter(
      (row) => row.screening_decision === "survives",
    );
    expect(survivors).toHaveLength(1);
    const registry = loadModelRegistry();
    const { mc1_document_extraction, ...others } = registry.classes;
    const { primary, ...extraction } = mc1_document_extraction;
    expect(primary).toBe(survivors[0]?.candidate);
    expect(extraction.fallback).toBeNull();
    expect(others.mc3_speech_to_text.fallback).toBeNull();
    expect(extraction.degraded).toBe("manual_form");
    expect(others.mc3_speech_to_text.degraded).toBe("typing");
    expect(others.mc5_drafting.primary).toBe(primary);
    expect(others.mc5_drafting.fallback).toBeNull();
    expect(others.mc5_drafting.degraded).toBe("template_only");
    for (const classId of [
      "mc1_document_extraction",
      "mc3_speech_to_text",
    ] as const) {
      const decision = readFileSync(
        new URL(
          `../../../../evaluation/results/held-out-2026-09-28/${classId}/decision.md`,
          import.meta.url,
        ),
        "utf8",
      );
      expect(decision).toContain(
        "I adopt `" +
          registry.classes[classId].primary +
          "` as my product primary",
      );
    }
    expect(sha256Hex(canonicalJson({ others, extraction }))).toBe(
      "4cf67ad90f08c121179e1c3f9c39dc60c721548d9279d9caad9c7253532f2170",
    );
  });

  it("loads all seven classes with valid references", () => {
    const registry = loadModelRegistry();
    expect(Object.keys(registry.classes)).toHaveLength(7);
    for (const value of Object.values(registry.classes)) {
      expect(value.status).toBe("pre_registered");
      expect(value.candidates[value.primary]).toBeDefined();
      if (value.fallback !== null)
        expect(value.candidates[value.fallback]).toBeDefined();
    }
    expect(registrySha256(registry)).toMatch(/^[a-f0-9]{64}$/);
  });
  it("rejects missing references and unknown candidates", () => {
    const registry = fakeRegistry();
    const value = registry.classes.mc1_document_extraction;
    expect(
      modelRegistrySchema.safeParse({
        ...registry,
        classes: {
          ...registry.classes,
          mc1_document_extraction: { ...value, primary: "missing" },
        },
      }).success,
    ).toBe(false);
    expect(() =>
      getCandidate(registry, "mc1_document_extraction", "missing"),
    ).toThrow(UnknownCandidateError);
  });
});
