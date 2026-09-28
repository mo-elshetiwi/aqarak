import { z } from "zod";
import { role, initiator, channel, fieldProvenance } from "../vocabulary";
import { encodeCanonical } from "./canonical";

const uuid = z.guid().regex(/^[0-9a-f-]+$/);
const snakeCase = z.string().regex(/^[a-z][a-z0-9_]*$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const utcInstant = z.iso.datetime().regex(/T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/);

/** Validates all stored event fields before building an audit projection. */
export const auditEventContent = z
  .strictObject({
    event_id: uuid,
    company_id: uuid,
    seq: z.number().int().positive(),
    occurred_at: utcInstant,
    tx_id: z.string().regex(/^\d+$/),
    event_type: z.string().regex(/^[a-z_]+\.[a-z_]+$/),
    actor_account_id: uuid.nullable(),
    actor_role: role.nullable(),
    on_behalf_of: uuid.nullable(),
    initiator,
    channel,
    subject_type: z.string().regex(/^[a-z_]+$/),
    subject_id: uuid,
    version_before: z.number().int().nonnegative().nullable(),
    version_after: z.number().int().nonnegative().nullable(),
    changed_fields: z.array(snakeCase).readonly(),
    before_hash: hash.nullable(),
    after_hash: hash.nullable(),
    reason: z.string().nullable(),
    drafted_action_id: uuid.nullable(),
    field_provenance: z
      .record(snakeCase, fieldProvenance)
      .readonly()
      .nullable(),
    model_call_ids: z.array(uuid).readonly(),
    registry_entry: z.string().nullable(),
    prompt_version: z.string().nullable(),
    tool_version: z.string().nullable(),
    policy_decision: z
      .strictObject({
        policy_version: z.string(),
        result: z.enum(["allow", "deny"]),
        reasons: z.array(z.string()).readonly(),
      })
      .readonly()
      .nullable(),
    idempotency_key: z.string().nullable(),
    trace_id: z.string().nullable(),
    visibility: z.enum(["staff", "parties", "all"]),
    retention_class: z.enum(["company_lifetime", "ninety_days"]),
  })
  .readonly();

/** Describes validated stored content for one company's audit event. */
export type AuditEventContent = z.infer<typeof auditEventContent>;

/** Projects a stored event with six fractional timestamp digits before hashing.
 * @throws {TypeError} If event fields, strings or canonical keys are malformed.
 * @throws {RangeError} If a canonical number is non-finite or unsafe.
 */
export function auditEventCanonicalText(content: AuditEventContent): string {
  const parsed = auditEventContent.safeParse(content);
  if (!parsed.success) {
    throw new TypeError("Invalid audit event content");
  }
  const event = parsed.data;
  const [seconds = "", fraction = ""] = event.occurred_at
    .slice(0, -1)
    .split(".");
  return encodeCanonical({
    ...event,
    occurred_at: `${seconds}.${fraction.padEnd(6, "0")}Z`,
  });
}
