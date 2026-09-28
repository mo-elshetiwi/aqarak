import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { safetyCriticalFlag } from "@aqarak/domain";
import {
  fieldProvenance,
  reportDecision,
  type ConfirmBody,
} from "./intake-policy";
import type { DraftRow } from "./intake-records";
const draft: DraftRow["payload"] = {
  unitId: randomUUID(),
  language: "en",
  voiceMediaId: null,
  photoMediaIds: [],
  typedText: null,
  transcript: "The tap leaks",
  category: "plumbing",
  priority: "routine",
  safetyFlags: [],
  description: "Leaking tap",
  payer: "owner",
  transcriptionMode: "model",
  triageMode: "model",
  confidence: 0.9,
};
const confirmed: ConfirmBody = {
  expectedVersion: 1,
  transcript: draft.transcript,
  category: draft.category,
  priority: draft.priority,
  safetyFlags: [],
  description: draft.description,
};
it.each([
  ["/transcript", {}, {}, "ai_confirmed"],
  ["/transcript", {}, { transcript: "Edited transcript" }, "ai_edited"],
  [
    "/transcript",
    { transcriptionMode: "degraded", transcript: null },
    { transcript: "Typed transcript" },
    "human_entered",
  ],
  [
    "/transcript",
    { transcriptionMode: "not_requested", transcript: null },
    {},
    "human_entered",
  ],
  ["/category", {}, {}, "ai_confirmed"],
  ["/category", {}, { category: "other" }, "ai_edited"],
  ["/category", { triageMode: "degraded" }, {}, "human_entered"],
  ["/priority", {}, {}, "ai_confirmed"],
  ["/priority", {}, { priority: "urgent" }, "ai_edited"],
  ["/priority", { triageMode: "degraded" }, {}, "human_entered"],
  ["/safety_flags", {}, {}, "ai_confirmed"],
  ["/safety_flags", {}, { safetyFlags: ["gas_smell"] }, "ai_edited"],
  ["/safety_flags", { triageMode: "degraded" }, {}, "human_entered"],
  ["/description", {}, {}, "ai_confirmed"],
  ["/description", {}, { description: "Edited summary" }, "ai_edited"],
  ["/description", { triageMode: "degraded" }, {}, "human_entered"],
] as const)(
  "AC-4 provenance %s %j %j is %s",
  (path, changes, edits, expected) => {
    expect(
      fieldProvenance(
        { ...draft, ...changes },
        {
          ...confirmed,
          ...edits,
          safetyFlags: [...("safetyFlags" in edits ? edits.safetyFlags : [])],
        },
      )[path],
    ).toBe(expected);
  },
);
it.each(safetyCriticalFlag.options)(
  "AC-5 %s forces emergency with and without a linked owner",
  (flag) => {
    const actor = randomUUID();
    for (const ownerAccountId of [null, randomUUID()])
      expect(
        reportDecision({
          id: randomUUID(),
          actorId: actor,
          authorId: actor,
          role: "tenant",
          ownerAccountId,
          payer: "owner",
          confirmed: { ...confirmed, safetyFlags: [flag] },
        }),
      ).toEqual({
        status: "reported",
        priority: "emergency",
        safetyCritical: true,
      });
  },
);
it("preserves routine priority without flags and refuses another report author", () => {
  const actor = randomUUID();
  const input = {
    id: randomUUID(),
    actorId: actor,
    authorId: actor,
    role: "tenant" as const,
    ownerAccountId: null,
    payer: "owner" as const,
    confirmed,
  };
  expect(reportDecision(input)).toEqual({
    status: "reported",
    priority: "routine",
    safetyCritical: false,
  });
  expect(() => reportDecision({ ...input, authorId: randomUUID() })).toThrow(
    "NOT_AUTHORISED",
  );
});
