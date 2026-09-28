import { refuse, requireReason, type DomainError } from "../errors";
import { nonNegativeFils } from "../money";
import { ok, type Result } from "../result";
import { localDate } from "../time";
import type { DiscrepancyClass } from "../vocabulary";
import type { TawtheeqErrorCode } from "./evidence";

/** Describes discrepancy classes and value kinds for each supported field. */
export const discrepancyFields = {
  unt_number: { class: "identity", kind: "identity_number" },
  owner_id_number: { class: "identity", kind: "identity_number" },
  tenant_id_number: { class: "identity", kind: "identity_number" },
  term_start: { class: "material", kind: "date" },
  term_end: { class: "material", kind: "date" },
  annual_rent_fils: { class: "material", kind: "amount" },
  total_fils: { class: "material", kind: "amount" },
  deposit_fils: { class: "material", kind: "amount" },
  payment_schedule: { class: "material", kind: "schedule" },
  contract_type: { class: "material", kind: "text" },
  grace_days: { class: "material", kind: "integer" },
  occupants: { class: "minor", kind: "text" },
  utilities: { class: "minor", kind: "text" },
  contacts: { class: "minor", kind: "text" },
  owner_name: { class: "minor", kind: "text" },
  tenant_name: { class: "minor", kind: "text" },
} as const;
/** Identifies a field supported by the discrepancy policy. */
export type DiscrepancyField = keyof typeof discrepancyFields;
/** Carries an immutable extracted value, including structured payment schedules. */
export type DiscrepancyValue =
  | string
  | number
  | readonly {
      readonly seqNo: number;
      readonly amountFils: number;
      readonly vatFils: number;
    }[];
/** Holds the field values of a contract version without mutating prior versions. */
export type ContractFieldValues = Readonly<
  Partial<Record<DiscrepancyField, DiscrepancyValue>>
>;
/** Carries a mismatch between the current contract and its registered document. */
export interface TawtheeqDiscrepancy {
  readonly field: DiscrepancyField;
  readonly priorValue: DiscrepancyValue;
  readonly registeredValue: DiscrepancyValue;
}
/** Records the manager's choice and mandatory explanation for a discrepancy. */
export type ResolutionChoice =
  | {
      readonly kind: "adopt" | "cancel_and_reregister";
      readonly reason: string | null;
    }
  | {
      readonly kind: "mark_equivalent";
      readonly reason: string | null;
      readonly basis: "formatting" | "transliteration";
    };
/** Binds a resolution to the discrepancy field it addresses. */
export interface DiscrepancyResolutionInput {
  readonly field: DiscrepancyField;
  readonly choice: ResolutionChoice;
}
/** Stores a validated discrepancy resolution with a trimmed nonempty reason. */
export interface ResolvedDiscrepancy extends TawtheeqDiscrepancy {
  readonly resolution: ResolutionChoice & { readonly reason: string };
}
/** Carries a new immutable version containing only the adopted changes over its predecessor. */
export interface TawtheeqAdoptionVersion {
  readonly kind: "tawtheeq_adoption";
  readonly contentHash: string;
  readonly values: ContractFieldValues;
  readonly changedFields: ContractFieldValues;
}

/** Classifies a discrepancy using the exported field policy table. */
export function classifyDiscrepancy(
  fieldKey: DiscrepancyField,
): DiscrepancyClass {
  return discrepancyFields[fieldKey].class;
}

function validValue(field: DiscrepancyField, value: DiscrepancyValue): boolean {
  switch (discrepancyFields[field].kind) {
    case "amount":
      return nonNegativeFils.safeParse(value).success;
    case "date":
      return localDate.safeParse(value).success;
    case "integer":
      return (
        typeof value === "number" && Number.isSafeInteger(value) && value >= 0
      );
    case "identity_number":
    case "text":
      return typeof value === "string" && value.trim() !== "";
    case "schedule":
      return (
        typeof value !== "string" &&
        typeof value !== "number" &&
        value.length > 0 &&
        value.every(
          (line) =>
            Number.isSafeInteger(line.seqNo) &&
            line.seqNo > 0 &&
            nonNegativeFils.safeParse(line.amountFils).success &&
            nonNegativeFils.safeParse(line.vatFils).success,
        )
      );
  }
}

function formattingOf(value: DiscrepancyValue): string {
  return (typeof value === "string" ? value : "")
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** Resolves a mismatch while enforcing reasons and text-only equivalence. */
export function resolveDiscrepancy(
  discrepancy: TawtheeqDiscrepancy,
  choice: ResolutionChoice,
): Result<ResolvedDiscrepancy, DomainError<TawtheeqErrorCode>> {
  const reason = requireReason(choice.reason);
  if (!reason.ok) return reason;
  if (choice.kind === "mark_equivalent") {
    if (discrepancyFields[discrepancy.field].kind !== "text")
      return refuse("MARK_EQUIVALENT_NOT_ALLOWED", discrepancy.field);
    if (
      choice.basis === "formatting" &&
      formattingOf(discrepancy.priorValue) !==
        formattingOf(discrepancy.registeredValue)
    )
      return refuse("MARK_EQUIVALENT_NOT_ALLOWED", discrepancy.field);
  }
  if (classifyDiscrepancy(discrepancy.field) === "identity")
    return refuse("IDENTITY_MISMATCH", discrepancy.field);
  if (!validValue(discrepancy.field, discrepancy.registeredValue))
    return refuse("INVALID_INPUT", discrepancy.field);
  return ok({
    ...discrepancy,
    resolution: { ...choice, reason: reason.value },
  });
}

/** Resolves every discrepancy exactly once, rejecting missing or duplicate choices. */
export function resolveDiscrepancies(
  discrepancies: readonly TawtheeqDiscrepancy[],
  choices: readonly DiscrepancyResolutionInput[],
): Result<readonly ResolvedDiscrepancy[], DomainError<TawtheeqErrorCode>> {
  if (
    discrepancies.length === 0 ||
    choices.length !== discrepancies.length ||
    new Set(choices.map((item) => item.field)).size !== choices.length ||
    new Set(discrepancies.map((item) => item.field)).size !==
      discrepancies.length
  )
    return refuse("DISCREPANCIES_UNRESOLVED");
  const resolved: ResolvedDiscrepancy[] = [];
  for (const discrepancy of discrepancies) {
    const choice = choices.find((item) => item.field === discrepancy.field);
    if (choice === undefined)
      return refuse("DISCREPANCIES_UNRESOLVED", discrepancy.field);
    const result = resolveDiscrepancy(discrepancy, choice.choice);
    if (!result.ok) return result;
    resolved.push(result.value);
  }
  return ok(resolved);
}

/** Determines whether adoption requires the frozen owner's new approval. */
export function requiresOwnerReapproval(
  frozenOwnerGate: boolean,
  resolutions: readonly ResolvedDiscrepancy[],
): boolean {
  return (
    frozenOwnerGate &&
    resolutions.some(
      (item) =>
        item.resolution.kind === "adopt" &&
        classifyDiscrepancy(item.field) === "material",
    )
  );
}

/** Produces the prior values plus adopted fields, leaving both inputs untouched. */
export function createAdoptionVersion(
  priorValues: ContractFieldValues,
  resolutions: readonly ResolvedDiscrepancy[],
  contentHash: string,
): Result<TawtheeqAdoptionVersion, DomainError<TawtheeqErrorCode>> {
  if (contentHash.trim() === "") return refuse("INVALID_INPUT", "content_hash");
  const changedFields: Partial<Record<DiscrepancyField, DiscrepancyValue>> = {};
  for (const item of resolutions) {
    const valid = resolveDiscrepancy(item, item.resolution);
    if (!valid.ok) return valid;
    if (item.resolution.kind === "adopt") {
      if (
        JSON.stringify(priorValues[item.field]) !==
        JSON.stringify(item.priorValue)
      )
        return refuse("STALE_SUBJECT_HASH", item.field);
      changedFields[item.field] = item.registeredValue;
    }
  }
  return ok({
    kind: "tawtheeq_adoption",
    contentHash,
    values: { ...priorValues, ...changedFields },
    changedFields,
  });
}
