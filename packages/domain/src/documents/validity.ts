import { daysBetween, type LocalDate } from "../time";
import type { DocumentType, DocumentValidity } from "../vocabulary";
import type { DocumentVersionSnapshot } from "./version";

/**
 * Derives validity at read time, including the entire expiry day.
 * @throws {RangeError} If the reminder lead is not a nonnegative safe integer.
 */
export function deriveDocumentValidity(input: {
  readonly expiryDate: LocalDate | null;
  readonly leadDays: number;
  readonly on: LocalDate;
}): DocumentValidity {
  if (!Number.isSafeInteger(input.leadDays) || input.leadDays < 0)
    throw new RangeError("Lead days must be a nonnegative safe integer");
  if (input.expiryDate === null) return "valid";
  const remaining = daysBetween(input.on, input.expiryDate);
  if (remaining < 0) return "expired";
  return remaining <= input.leadDays ? "expiring_soon" : "valid";
}
/** Identifies the onboarding party whose document requirements apply. */
export type OnboardingPartyKind =
  "owner" | "individual_tenant" | "company_tenant";
/** Describes alternatives satisfying one required onboarding document. */
export type OnboardingDocumentRequirement = readonly DocumentType[];
/** Defines required accepted documents, including the owner's title or site-plan alternative. */
export const onboardingDocumentRequirements: Readonly<
  Record<OnboardingPartyKind, readonly OnboardingDocumentRequirement[]>
> = {
  owner: [
    ["emirates_id"],
    ["title_deed", "site_plan"],
    ["management_agreement"],
    ["tawtheeq_authorisation"],
  ],
  individual_tenant: [["emirates_id"]],
  company_tenant: [["trade_licence"], ["signatory_id"]],
};
/** Returns unsatisfied requirement groups, retaining valid document alternatives. */
export function missingOnboardingDocuments(
  partyKind: OnboardingPartyKind,
  versions: readonly Pick<
    DocumentVersionSnapshot,
    "documentType" | "review_status" | "expiryDate"
  >[],
  on: LocalDate,
): readonly OnboardingDocumentRequirement[] {
  const accepted = new Set(
    versions
      .filter(
        (version) =>
          version.review_status === "accepted" &&
          deriveDocumentValidity({
            expiryDate: version.expiryDate,
            leadDays: 0,
            on,
          }) !== "expired",
      )
      .map((version) => version.documentType),
  );
  return onboardingDocumentRequirements[partyKind].filter(
    (alternatives) => !alternatives.some((type) => accepted.has(type)),
  );
}
/** Checks only the required fifteen ASCII digits without asserting identity validity. */
export function isEmiratesIdNumber(value: string): boolean {
  return /^[0-9]{15}$/.test(value);
}
