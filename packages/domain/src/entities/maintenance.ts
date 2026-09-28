import { z } from "zod";
import * as ids from "../ids";
import { nonNegativeFils, positiveFils } from "../money";
import { utcInstant } from "../time";
import * as vocabulary from "../vocabulary";
import { instantMicroseconds, standardFields, text } from "./shared";

/** Records a maintenance ticket with emergency priority and a description. */
export const ticketRecord = z
  .strictObject({
    ...standardFields(ids.ticketId),
    unitId: ids.unitId,
    reportedByAccountId: ids.personAccountId,
    category: vocabulary.ticketCategory,
    priority: vocabulary.ticketPriority,
    safetyCritical: z.boolean(),
    status: vocabulary.ticketStatus,
    payer: vocabulary.costPayer.nullable(),
    descriptionEn: text.nullable(),
    descriptionAr: text.nullable(),
    rating: z.int().min(1).max(5).nullable(),
    linkedTicketId: ids.ticketId.nullable(),
  })
  .refine(
    (record) =>
      record.safetyCritical ? record.priority === "emergency" : true,
    {
      message: "Safety critical tickets require emergency priority",
      path: ["priority"],
    },
  )
  .refine(
    (record) => record.descriptionEn !== null || record.descriptionAr !== null,
    {
      message: "A ticket requires a description in at least one language",
      path: ["descriptionEn"],
    },
  );
/** Represents a stored maintenance ticket. */
export type TicketRecord = z.infer<typeof ticketRecord>;

/** Records a maintenance quote from exactly one vendor or technician. */
export const quoteRecord = z
  .strictObject({
    ...standardFields(ids.quoteId),
    ticketId: ids.ticketId,
    vendorId: ids.vendorId.nullable(),
    technicianProfileId: ids.technicianProfileId.nullable(),
    amountFils: positiveFils,
    vatFils: nonNegativeFils,
    status: vocabulary.quoteStatus,
  })
  .refine(
    (record) =>
      (record.vendorId === null) !== (record.technicianProfileId === null),
    { message: "A quote requires exactly one provider", path: ["vendorId"] },
  );
/** Represents a stored maintenance quote. */
export type QuoteRecord = z.infer<typeof quoteRecord>;

/** Records a provider visit and contact evidence for an emergency dispatch. */
export const dispatchRecord = z
  .strictObject({
    ...standardFields(ids.dispatchId),
    ticketId: ids.ticketId,
    technicianProfileId: ids.technicianProfileId.nullable(),
    vendorId: ids.vendorId.nullable(),
    visitFrom: utcInstant,
    visitTo: utcInstant,
    status: vocabulary.dispatchStatus,
    emergencyRuleUsed: z.boolean(),
    contactAttempts: z.array(
      z.strictObject({
        at: utcInstant,
        channel: z.enum(["phone", "whatsapp", "email"]),
        outcome: text,
      }),
    ),
  })
  .refine(
    (record) =>
      (record.vendorId === null) !== (record.technicianProfileId === null),
    { message: "A dispatch requires exactly one provider", path: ["vendorId"] },
  )
  .refine(
    (record) =>
      utcInstant.safeParse(record.visitTo).success &&
      utcInstant.safeParse(record.visitFrom).success &&
      instantMicroseconds(record.visitTo) >
        instantMicroseconds(record.visitFrom),
    { message: "A visit must end after it starts", path: ["visitTo"] },
  )
  .refine(
    (record) =>
      record.emergencyRuleUsed ? record.contactAttempts.length > 0 : true,
    {
      message: "Emergency dispatch requires a contact attempt",
      path: ["contactAttempts"],
    },
  );
/** Represents a stored maintenance dispatch. */
export type DispatchRecord = z.infer<typeof dispatchRecord>;
