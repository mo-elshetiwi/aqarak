import { z } from "zod";
import * as ids from "../ids";
import { utcInstant } from "../time";
import * as vocabulary from "../vocabulary";
import {
  fifteenDigits,
  instantMicroseconds,
  language,
  phoneE164,
  sha256,
  standardFields,
  subjectId,
  text,
} from "./shared";

/** Records a company and its default owner approval policy. */
export const companyRecord = z.strictObject({
  ...standardFields(ids.companyId),
  kind: vocabulary.companyKind,
  legalNameEn: text,
  legalNameAr: text,
  tradeLicenceNo: text,
  trn: fifteenDigits.nullable(),
  defaultOwnerGate: z.boolean(),
  isDemo: z.boolean(),
});
/** Represents a stored company and its default owner approval policy. */
export type CompanyRecord = z.infer<typeof companyRecord>;

/** Records a person account shared across companies. */
export const personAccountRecord = z
  .strictObject({
    ...standardFields(ids.personAccountId),
    authSubject: text,
    email: z.email(),
    displayName: text,
    preferredLanguage: language,
  })
  .omit({ companyId: true });
/** Represents a stored person account shared across companies. */
export type PersonAccountRecord = z.infer<typeof personAccountRecord>;

/** Records a company membership with at least one staff responsibility. */
export const membershipRecord = z
  .strictObject({
    ...standardFields(ids.membershipId),
    accountId: ids.personAccountId,
    isManager: z.boolean(),
    isTechnician: z.boolean(),
    isCompanyAdministrator: z.boolean(),
    isAccountant: z.boolean(),
    status: vocabulary.membershipStatus,
  })
  .refine(
    (record) =>
      [
        record.isManager,
        record.isTechnician,
        record.isCompanyAdministrator,
        record.isAccountant,
      ].some(Boolean),
    {
      message: "A membership requires a staff responsibility",
      path: ["isManager"],
    },
  );
/** Represents a stored company membership with staff responsibilities. */
export type MembershipRecord = z.infer<typeof membershipRecord>;

/** Records a technician's membership, skills and contact number. */
export const technicianProfileRecord = z.strictObject({
  ...standardFields(ids.technicianProfileId),
  membershipId: ids.membershipId,
  vendorId: ids.vendorId.nullable(),
  skills: z.array(vocabulary.ticketCategory),
  phoneE164,
});
/** Represents a stored technician profile. */
export type TechnicianProfileRecord = z.infer<typeof technicianProfileRecord>;

/** Records a staff or party invitation with a seven day expiry. */
export const invitationRecord = z
  .strictObject({
    ...standardFields(ids.invitationId),
    kind: vocabulary.invitationKind,
    email: z.email(),
    targetId: subjectId.nullable(),
    tokenHash: sha256,
    sentAt: utcInstant,
    expiresAt: utcInstant,
    status: vocabulary.invitationStatus,
  })
  .refine(
    (record) => (record.kind === "staff") === (record.targetId === null),
    { message: "Only party invitations require a target", path: ["targetId"] },
  )
  .refine(
    (record) =>
      utcInstant.safeParse(record.expiresAt).success &&
      utcInstant.safeParse(record.sentAt).success &&
      instantMicroseconds(record.expiresAt) -
        instantMicroseconds(record.sentAt) ===
        604_800_000_000n,
    {
      message: "An invitation expires exactly seven days after sending",
      path: ["expiresAt"],
    },
  );
/** Represents a stored invitation with a seven day expiry. */
export type InvitationRecord = z.infer<typeof invitationRecord>;
