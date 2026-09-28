import { describe, expect, it } from "vitest";
import {
  canContinue,
  confidenceCategory,
  createReviewState,
  provenanceOf,
  reviewReducer,
  type ReviewAction,
} from "./review-state";
import type {
  ConfidenceCategory,
  FieldClass,
  SuggestedFieldInput,
} from "./types";
const field: SuggestedFieldInput = {
  id: "name",
  label: "Name",
  fieldClass: "text",
  value: "Khalid",
  modelCategory: "suggested",
  region: null,
  requiresSourceCheck: false,
};
const critical: SuggestedFieldInput = {
  ...field,
  id: "identity",
  fieldClass: "identity_number",
  requiresSourceCheck: true,
};
const initial = (): ReturnType<typeof createReviewState> =>
  createReviewState([field, critical], ["text"]);
describe("confidence category", () => {
  const categories: ConfidenceCategory[] = ["confirm", "check", "suggested"];
  const criticalClasses: FieldClass[] = [
    "identity_number",
    "date",
    "money",
    "unit_code",
    "plot_code",
  ];
  it.each(
    criticalClasses.flatMap((fieldClass) =>
      categories.flatMap((category) =>
        [true, false].map((calibrated) => ({
          fieldClass,
          category,
          calibrated,
        })),
      ),
    ),
  )(
    "forces Confirm for $fieldClass / $category / $calibrated",
    ({ fieldClass, category, calibrated }) => {
      expect(confidenceCategory(fieldClass, category, calibrated)).toBe(
        "confirm",
      );
    },
  );
  it.each(
    (["text", "person_name", "nationality"] as const).flatMap((fieldClass) =>
      categories.map((category) => ({ fieldClass, category })),
    ),
  )(
    "requires calibration for $fieldClass / $category",
    ({ fieldClass, category }) => {
      expect(confidenceCategory(fieldClass, category, false)).toBe("check");
      expect(confidenceCategory(fieldClass, category, true)).toBe(category);
    },
  );
});
describe("review decisions", () => {
  it.each([
    [{ type: "accept", id: "name" }, "accepted", "Khalid", "ai_confirmed"],
    [
      { type: "edit", id: "name", value: "Khalid Al Suwaidi" },
      "edited",
      "Khalid Al Suwaidi",
      "ai_edited",
    ],
    [
      { type: "mark_not_on_document", id: "name" },
      "not_on_document",
      null,
      "not_on_document",
    ],
  ] satisfies [ReviewAction, string, string | null, string][])(
    "records %j with provenance",
    (action, status, value, provenance) => {
      const state = reviewReducer(initial(), action);
      expect(state.decisions.name).toEqual({
        status,
        value,
        sourceViewed: false,
      });
      const decision = state.decisions.name;
      expect(decision && provenanceOf(decision)).toBe(provenance);
    },
  );
  it("refuses acceptance until source viewing and preserves the original state", () => {
    const state = initial();
    expect(reviewReducer(state, { type: "accept", id: "identity" })).toBe(
      state,
    );
    const viewed = reviewReducer(state, {
      type: "view_source",
      id: "identity",
    });
    expect(viewed.decisions.identity?.sourceViewed).toBe(true);
    expect(viewed.decisions.identity?.status).toBe("undecided");
    expect(
      reviewReducer(viewed, { type: "accept", id: "identity" }).decisions
        .identity?.status,
    ).toBe("accepted");
    expect(state.decisions.identity?.sourceViewed).toBe(false);
  });
  it.each(["accept", "edit", "mark_not_on_document"] as const)(
    "reverts %s to the original suggestion without losing source history",
    (type) => {
      let state = reviewReducer(initial(), { type: "view_source", id: "name" });
      state = reviewReducer(
        state,
        type === "edit"
          ? { type, id: "name", value: "Changed" }
          : { type, id: "name" },
      );
      const decision = reviewReducer(state, { type: "revert", id: "name" })
        .decisions.name;
      expect(decision).toEqual({
        status: "undecided",
        value: "Khalid",
        sourceViewed: true,
      });
      expect(decision && provenanceOf(decision)).toBeNull();
    },
  );
  it("bulk acceptance changes only undecided Suggested fields and respects source checks", () => {
    const fields: SuggestedFieldInput[] = [
      field,
      critical,
      { ...field, id: "check", modelCategory: "check" },
      { ...field, id: "confirm", modelCategory: "confirm" },
      { ...field, id: "edited" },
      { ...field, id: "blocked", requiresSourceCheck: true },
      { ...field, id: "uncalibrated", fieldClass: "nationality" },
    ];
    const state = reviewReducer(createReviewState(fields, ["text"]), {
      type: "edit",
      id: "edited",
      value: "Edited",
    });
    const next = reviewReducer(state, { type: "accept_remaining_suggested" });
    expect(next.decisions.name?.status).toBe("accepted");
    for (const id of [
      "identity",
      "check",
      "confirm",
      "blocked",
      "uncalibrated",
    ])
      expect(next.decisions[id]?.status).toBe("undecided");
    expect(next.decisions.edited).toEqual(state.decisions.edited);
  });
  it.each(["accept", "edit", "mark_not_on_document"] as const)(
    "allows continuation after a Confirm field is decided with %s",
    (type) => {
      let state = initial();
      expect(canContinue(state)).toBe(false);
      state = reviewReducer(state, { type: "view_source", id: "identity" });
      state = reviewReducer(
        state,
        type === "edit"
          ? { type, id: "identity", value: "784" }
          : { type, id: "identity" },
      );
      expect(canContinue(state)).toBe(true);
      expect(state.decisions.name?.status).toBe("undecided");
      expect(
        canContinue(reviewReducer(state, { type: "revert", id: "identity" })),
      ).toBe(false);
    },
  );
  it("does not fill an absent field and restores its empty suggestion", () => {
    const state = createReviewState([{ ...field, value: null }], ["text"]);
    expect(state.decisions.name?.value).toBeNull();
    const accepted = reviewReducer(state, { type: "accept", id: "name" });
    expect(accepted.decisions.name?.status).toBe("not_on_document");
    expect(
      reviewReducer(accepted, { type: "revert", id: "name" }).decisions.name
        ?.value,
    ).toBeNull();
  });
  it("ignores unknown fields and empty edits", () => {
    const state = initial();
    expect(
      reviewReducer(state, { type: "edit", id: "name", value: "  " }),
    ).toBe(state);
    expect(reviewReducer(state, { type: "accept", id: "missing" })).toBe(state);
  });
});
