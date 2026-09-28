import type {
  ConfidenceCategory,
  FieldClass,
  FieldDecision,
  FieldProvenance,
  SuggestedFieldInput,
} from "./types";

export interface ReviewState {
  fields: SuggestedFieldInput[];
  calibratedClasses: FieldClass[];
  decisions: Record<string, FieldDecision>;
}
export type ReviewAction =
  | {
      type: "accept" | "mark_not_on_document" | "revert" | "view_source";
      id: string;
    }
  | { type: "edit"; id: string; value: string }
  | { type: "accept_remaining_suggested" };

const criticalClasses: readonly FieldClass[] = [
  "identity_number",
  "date",
  "money",
  "unit_code",
  "plot_code",
];
/** Requires confirmation for critical fields and uses model confidence only for calibrated classes. */
export function confidenceCategory(
  fieldClass: FieldClass,
  modelCategory: ConfidenceCategory,
  calibrated: boolean,
): ConfidenceCategory {
  if (criticalClasses.includes(fieldClass)) return "confirm";
  return calibrated ? modelCategory : "check";
}
/** Initialises each field as undecided with its suggested value and an unopened source. */
export function createReviewState(
  fields: SuggestedFieldInput[],
  calibratedClasses: FieldClass[],
): ReviewState {
  return {
    fields,
    calibratedClasses,
    decisions: Object.fromEntries(
      fields.map((field) => [
        field.id,
        {
          status: "undecided",
          value: field.value,
          sourceViewed: false,
        },
      ]),
    ),
  };
}
/** Resolves a field confidence category using the review state calibration. */
export function categoryOf(
  state: ReviewState,
  field: SuggestedFieldInput,
): ConfidenceCategory {
  return confidenceCategory(
    field.fieldClass,
    field.modelCategory,
    state.calibratedClasses.includes(field.fieldClass),
  );
}
function acceptDecision(
  field: SuggestedFieldInput,
  decision: FieldDecision,
): FieldDecision {
  if (
    decision.status !== "undecided" ||
    (field.requiresSourceCheck && !decision.sourceViewed)
  )
    return decision;
  return {
    ...decision,
    status: decision.value === null ? "not_on_document" : "accepted",
  };
}
function updateDecision(
  field: SuggestedFieldInput,
  decision: FieldDecision,
  action: Exclude<ReviewAction, { type: "accept_remaining_suggested" }>,
): FieldDecision {
  switch (action.type) {
    case "accept":
      return acceptDecision(field, decision);
    case "edit":
      return action.value.trim()
        ? { ...decision, status: "edited", value: action.value.trim() }
        : decision;
    case "mark_not_on_document":
      return { ...decision, status: "not_on_document", value: null };
    case "revert":
      return {
        status: "undecided",
        value: field.value,
        sourceViewed: decision.sourceViewed,
      };
    case "view_source":
      return { ...decision, sourceViewed: true };
  }
}
/** Applies field decisions and bulk acceptance while preserving source-check requirements. */
export function reviewReducer(
  state: ReviewState,
  action: ReviewAction,
): ReviewState {
  if (action.type === "accept_remaining_suggested") {
    const decisions = { ...state.decisions };
    for (const field of state.fields) {
      const decision = decisions[field.id];
      if (decision && categoryOf(state, field) === "suggested")
        decisions[field.id] = acceptDecision(field, decision);
    }
    return { ...state, decisions };
  }
  const field = state.fields.find((entry) => entry.id === action.id);
  const decision = state.decisions[action.id];
  if (!field || !decision) return state;
  const next = updateDecision(field, decision, action);
  if (next === decision) return state;
  return { ...state, decisions: { ...state.decisions, [action.id]: next } };
}
/** Maps completed decisions to their provenance and returns null for undecided fields. */
export function provenanceOf(decision: FieldDecision): FieldProvenance | null {
  switch (decision.status) {
    case "accepted":
      return "ai_confirmed";
    case "edited":
      return "ai_edited";
    case "not_on_document":
      return "not_on_document";
    case "undecided":
      return null;
  }
}
/** Allows continuation only when every field requiring confirmation has a decision. */
export function canContinue(state: ReviewState): boolean {
  return state.fields.every(
    (field) =>
      categoryOf(state, field) !== "confirm" ||
      (state.decisions[field.id] !== undefined &&
        state.decisions[field.id]?.status !== "undecided"),
  );
}
