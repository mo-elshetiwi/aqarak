import { z } from "zod";
import * as ids from "../ids";
import { basisPoints, nonNegativeFils } from "../money";
import { localDate } from "../time";
import * as vocabulary from "../vocabulary";
import { standardFields, subjectId, text } from "./shared";

/** Records a property and its owner approval override. */
export const propertyRecord = z.strictObject({
  ...standardFields(ids.propertyId),
  nameEn: text,
  nameAr: text,
  kind: vocabulary.propertyKind,
  areaEn: text.nullable(),
  areaAr: text.nullable(),
  plotNo: text.nullable(),
  titleDeedNo: text.nullable(),
  onwaniAddress: text.nullable(),
  ownerGateOverride: z.boolean().nullable(),
});
/** Represents a stored property and its approval override. */
export type PropertyRecord = z.infer<typeof propertyRecord>;

/** Records a unit and the explanation for a blocked status. */
export const unitRecord = z
  .strictObject({
    ...standardFields(ids.unitId),
    propertyId: ids.propertyId,
    unitNo: text,
    untNumber: text,
    kind: vocabulary.unitKind,
    use: vocabulary.unitUse,
    bedrooms: z.int().min(0).max(20).nullable(),
    areaSqm: z.number().positive().nullable(),
    status: vocabulary.unitStatus,
    blockReason: text.nullable(),
  })
  .refine(
    (record) => (record.status === "blocked") === (record.blockReason !== null),
    {
      message: "A block reason is required exactly when blocked",
      path: ["blockReason"],
    },
  );
/** Represents a stored unit and its blocking explanation. */
export type UnitRecord = z.infer<typeof unitRecord>;

/** Records a positive ownership share in a property. */
export const ownershipRecord = z.strictObject({
  ...standardFields(ids.ownershipId),
  ownerId: ids.ownerId,
  propertyId: ids.propertyId,
  shareBp: basisPoints.refine(
    (value) => value > 0,
    "An ownership share must be positive",
  ),
  isRepresentative: z.boolean(),
});
/** Represents a stored ownership share. */
export type OwnershipRecord = z.infer<typeof ownershipRecord>;

/** Records an owner's dated authority and financial approval limits. */
export const ownerMandateRecord = z
  .strictObject({
    ...standardFields(ids.ownerMandateId),
    ownerId: ids.ownerId,
    leaseAuthority: z.boolean(),
    ownerGate: z.boolean().nullable(),
    costThresholdFils: nonNegativeFils.nullable(),
    emergencyLimitFils: nonNegativeFils.nullable(),
    feeBp: basisPoints,
    startsOn: localDate,
    endsOn: localDate.nullable(),
    status: vocabulary.ownerMandateStatus,
  })
  .refine(
    (record) => record.endsOn === null || record.endsOn >= record.startsOn,
    { message: "A mandate cannot end before it starts", path: ["endsOn"] },
  );
/** Represents a stored owner mandate. */
export type OwnerMandateRecord = z.infer<typeof ownerMandateRecord>;

/** Records a property's inclusion in an owner's mandate. */
export const ownerMandatePropertyRecord = z.strictObject({
  ...standardFields(subjectId.brand<"OwnerMandatePropertyId">()),
  ownerMandateId: ids.ownerMandateId,
  propertyId: ids.propertyId,
});
/** Represents a stored property reference within an owner mandate. */
export type OwnerMandatePropertyRecord = z.infer<
  typeof ownerMandatePropertyRecord
>;
