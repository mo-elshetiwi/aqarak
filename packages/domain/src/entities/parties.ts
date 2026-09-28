import { z } from "zod";
import * as ids from "../ids";
import { localDate } from "../time";
import * as vocabulary from "../vocabulary";
import {
  fifteenDigits,
  language,
  phoneE164,
  standardFields,
  text,
} from "./shared";

/** Records an owner, permitted bank details and the statement lock date. */
export const ownerRecord = z.strictObject({
  ...standardFields(ids.ownerId),
  fullNameEn: text,
  fullNameAr: text,
  eidNumber: fifteenDigits.nullable(),
  passportNo: text.nullable(),
  email: z.email(),
  phoneE164,
  preferredLanguage: language,
  bankName: text.nullable(),
  accountHolder: text.nullable(),
  iban: text.nullable(),
  linkedAccountId: ids.personAccountId.nullable(),
  statementLockedThrough: localDate.nullable(),
});
/** Represents a stored owner and permitted bank details. */
export type OwnerRecord = z.infer<typeof ownerRecord>;

/** Records a tenant's identity and signatory without bank account data. */
export const tenantRecord = z
  .strictObject({
    ...standardFields(ids.tenantId),
    kind: vocabulary.tenantKind,
    nameEn: text,
    nameAr: text,
    eidNumber: fifteenDigits.nullable(),
    passportNo: text.nullable(),
    tradeLicenceNo: text.nullable(),
    signatoryNameEn: text.nullable(),
    signatoryNameAr: text.nullable(),
    signatoryEidNumber: fifteenDigits.nullable(),
    email: z.email(),
    phoneE164,
    preferredLanguage: language,
    linkedAccountId: ids.personAccountId.nullable(),
  })
  .refine(
    (record) =>
      record.kind !== "company" ||
      [
        record.tradeLicenceNo,
        record.signatoryNameEn,
        record.signatoryNameAr,
        record.signatoryEidNumber,
      ].every((value) => value !== null),
    {
      message: "A company tenant requires its licence and signatory",
      path: ["tradeLicenceNo"],
    },
  )
  .refine(
    (record) =>
      record.kind !== "individual" ||
      record.eidNumber !== null ||
      record.passportNo !== null,
    {
      message: "An individual tenant requires an identity document",
      path: ["eidNumber"],
    },
  );
/** Represents a stored tenant identity without bank account data. */
export type TenantRecord = z.infer<typeof tenantRecord>;

/** Records an occupant attached to a specific contract version. */
export const occupantRecord = z.strictObject({
  ...standardFields(ids.occupantId),
  contractVersionId: ids.contractVersionId,
  fullName: text,
  relationship: vocabulary.occupantRelationship,
  eidNumber: fifteenDigits.nullable(),
});
/** Represents a stored occupant of a contract version. */
export type OccupantRecord = z.infer<typeof occupantRecord>;

/** Records a maintenance vendor and at least one service category. */
export const vendorRecord = z.strictObject({
  ...standardFields(ids.vendorId),
  nameEn: text,
  nameAr: text,
  tradeLicenceNo: text.nullable(),
  email: z.email().nullable(),
  phoneE164,
  categories: z.array(vocabulary.ticketCategory).min(1),
});
/** Represents a stored maintenance vendor. */
export type VendorRecord = z.infer<typeof vendorRecord>;
