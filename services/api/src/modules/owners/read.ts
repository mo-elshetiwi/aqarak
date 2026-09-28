import type { Row } from "@aqarak/db/data-api";
import {
  companyKind,
  localDate,
  ownerMandateStatus,
  propertyId,
  type OwnerGateMandate,
} from "../properties/lib/domain";
import type { z } from "zod";
import type { RequestScope } from "../properties/lib/runtime";
import {
  rows,
  uuid,
  text,
  nullableText,
  number,
  bool,
  param,
  utcTimestamp,
} from "../properties/lib/sql";
import { gate, today, maskEid, maskPassport } from "../properties/lib/gate";
import {
  documents,
  history,
  ownerOnboarding,
} from "../properties/lib/read-model";
import {
  ownerSummarySchema,
  ownerDetailSchema,
  mandateDetailSchema,
  ownerListItemSchema,
  ownerQuerySchema,
  documentSummarySchema,
  documentItemSchema,
} from "../properties/lib/schemas";
import { fail } from "../properties/lib/problem";
export function ownerSummary(row: Row): z.infer<typeof ownerSummarySchema> {
  return {
    id: text(row, "id"),
    version: number(row, "version"),
    fullName: { en: text(row, "full_name_en"), ar: text(row, "full_name_ar") },
    selfManaged: bool(row, "self_managed"),
    linked: row.linked_account_id != null,
  };
}
export async function activeMandate(
  scope: RequestScope,
  owner: string,
): Promise<z.infer<typeof mandateDetailSchema> | null> {
  const mandate = (
    await rows(
      scope.tx,
      "select * from estate.owner_mandate where company_id=:c and owner_id=:id and status='active'",
      [uuid("c", scope.audit.companyId), uuid("id", owner)],
    )
  )[0];
  if (!mandate) return null;
  const links = await rows(
    scope.tx,
    "select property_id from estate.mandate_property where company_id=:c and mandate_id=:id and status='active' order by property_id",
    [uuid("c", scope.audit.companyId), uuid("id", text(mandate, "id"))],
  );
  return {
    id: text(mandate, "id"),
    version: number(mandate, "version"),
    ownerGate: mandate.owner_gate == null ? null : bool(mandate, "owner_gate"),
    costThresholdFils: nullableText(mandate, "cost_threshold_fils"),
    feeBp: mandate.fee_bp == null ? null : number(mandate, "fee_bp"),
    startsOn: text(mandate, "starts_on"),
    endsOn: nullableText(mandate, "ends_on"),
    status: text(mandate, "status"),
    propertyIds: links.map((row) => text(row, "property_id")),
  };
}
export function gateMandate(
  mandate: z.infer<typeof mandateDetailSchema> | null,
): OwnerGateMandate | null {
  return mandate
    ? {
        status: ownerMandateStatus.parse(mandate.status),
        ownerGate: mandate.ownerGate,
        startsOn: localDate.parse(mandate.startsOn),
        endsOn: mandate.endsOn ? localDate.parse(mandate.endsOn) : null,
        propertyIds: mandate.propertyIds.map((id) => propertyId.parse(id)),
      }
    : null;
}
export async function ownerDetail(
  scope: RequestScope,
  row: Row,
): Promise<z.infer<typeof ownerDetailSchema>> {
  const id = text(row, "id");
  const properties = await rows(
    scope.tx,
    "select p.id,p.name_en,p.name_ar,(select count(*) from estate.unit u where u.company_id=p.company_id and u.property_id=p.id) as unit_count from estate.property p join estate.ownership o on o.company_id=p.company_id and o.property_id=p.id where o.company_id=:c and o.owner_id=:id order by p.name_en,p.id",
    [uuid("c", scope.audit.companyId), uuid("id", id)],
  );
  const mandate = await activeMandate(scope, id);
  const policy = gateMandate(mandate);
  const ownerProperty = propertyId.parse(id);
  const ownerGate = gate(
    {
      kind: companyKind.parse(scope.company.kind),
      defaultOwnerGate: bool(scope.company, "default_owner_gate"),
    },
    { id: ownerProperty, ownerGateOverride: null },
    policy ? { ...policy, propertyIds: [ownerProperty] } : null,
    today(),
  );
  if (ownerGate.source === "property_override")
    throw new Error("Unexpected owner gate source");
  const input = {
    companyId: scope.audit.companyId,
    type: "owner" as const,
    id,
  };
  const docs = await documents(scope.tx, input);
  const propertyDocs: z.infer<typeof documentItemSchema>[] = [];
  for (const property of properties)
    propertyDocs.push(
      ...(await documents(scope.tx, {
        ...input,
        type: "property",
        id: text(property, "id"),
      })),
    );
  const invitation = (
    await rows(
      scope.tx,
      "select id,status,expires_at from core.invitation where company_id=:c and kind='owner' and target_id=:id order by created_at desc,id desc limit 1",
      [uuid("c", scope.audit.companyId), uuid("id", id)],
    )
  )[0];
  const invitationItem = invitation
    ? {
        id: text(invitation, "id"),
        status: text(invitation, "status"),
        expiresAt: utcTimestamp(text(invitation, "expires_at")),
      }
    : null;
  const staff = scope.actor.roles.some((role) =>
    ["manager", "company_administrator", "accountant"].includes(role),
  );
  const bankAllowed =
    scope.actor.roles.some((role) =>
      ["manager", "accountant"].includes(role),
    ) || scope.actor.owner_ids.some((own) => own === id);
  return {
    ...ownerSummary(row),
    email: nullableText(row, "email"),
    phoneE164: nullableText(row, "phone_e164"),
    preferredLanguage: row.preferred_language === "ar" ? "ar" : "en",
    eidNumberMasked: maskEid(nullableText(row, "eid_number")),
    passportNoMasked: maskPassport(nullableText(row, "passport_no")),
    ...(bankAllowed
      ? {
          bank:
            row.iban == null && row.bank_name == null
              ? null
              : {
                  bankName: nullableText(row, "bank_name"),
                  accountHolder: nullableText(row, "account_holder"),
                  ibanLast4: nullableText(row, "iban")?.slice(-4) ?? null,
                },
        }
      : {}),
    mandate,
    ownerGate: {
      value: ownerGate.value,
      source: ownerGate.source,
      recorded: ownerGate.source === "mandate",
    },
    properties: properties.map((p) => ({
      id: text(p, "id"),
      name: { en: text(p, "name_en"), ar: text(p, "name_ar") },
      unitCount: number(p, "unit_count"),
    })),
    documents: docs,
    onboarding: ownerOnboarding(
      [...docs, ...propertyDocs],
      invitationItem?.status === "pending" &&
        invitationItem.expiresAt > new Date().toISOString(),
    ),
    invitation: invitationItem,
    history: staff ? await history(scope.tx, input) : [],
  };
}
function docSummary(
  detail: z.infer<typeof ownerDetailSchema>,
  type: string,
): z.infer<typeof documentSummarySchema> | null {
  const doc = detail.documents.find((item) => item.docType === type);
  const version = doc?.current ?? doc?.latest;
  return doc && version
    ? {
        documentId: doc.documentId,
        reviewStatus: version.reviewStatus,
        expiryDate: version.expiryDate,
        validity: version.validity,
      }
    : null;
}
function listItem(
  detail: z.infer<typeof ownerDetailSchema>,
): z.infer<typeof ownerListItemSchema> {
  return {
    id: detail.id,
    version: detail.version,
    fullName: detail.fullName,
    preferredLanguage: detail.preferredLanguage,
    selfManaged: detail.selfManaged,
    linked: detail.linked,
    properties: detail.properties.map(({ id, name }) => ({ id, name })),
    ownerGate: detail.ownerGate,
    managementAgreement: docSummary(detail, "management_agreement"),
    tawtheeqAuthorisation: docSummary(detail, "tawtheeq_authorisation"),
    onboarding: detail.onboarding.status,
  };
}
export function decodeCursor(
  cursor: string | undefined,
): { name: string; id: string } | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("name" in parsed) ||
      !("id" in parsed) ||
      typeof parsed.name !== "string" ||
      typeof parsed.id !== "string" ||
      !propertyId.safeParse(parsed.id).success
    )
      fail(400, "VALIDATION_FAILED", "cursor");
    return { name: parsed.name, id: parsed.id };
  } catch {
    return fail(400, "VALIDATION_FAILED", "cursor");
  }
}
export function encodeCursor(name: string, id: string): string {
  return Buffer.from(JSON.stringify({ name, id })).toString("base64url");
}
function matches(
  item: z.infer<typeof ownerListItemSchema>,
  query: z.infer<typeof ownerQuerySchema>,
): boolean {
  if (query.onboarding && item.onboarding !== query.onboarding) return false;
  if (query.gate === "not_recorded" && item.ownerGate.recorded) return false;
  if (query.gate === "on" && !item.ownerGate.value) return false;
  if (query.gate === "off" && item.ownerGate.value) return false;
  return (
    !query.mandateExpiring ||
    [item.managementAgreement, item.tawtheeqAuthorisation].some(
      (doc) => doc?.validity === "expired" || doc?.validity === "expiring_soon",
    )
  );
}
export async function listOwners(
  scope: RequestScope,
  input: unknown,
): Promise<{
  items: z.infer<typeof ownerListItemSchema>[];
  nextCursor: string | null;
}> {
  const query = ownerQuerySchema.parse(input);
  const cursor = decodeCursor(query.cursor);
  const staff = scope.actor.roles.some((role) =>
    ["manager", "accountant", "company_administrator"].includes(role),
  );
  const records = await rows(
    scope.tx,
    `select * from party.owner where company_id=:c and (cast(:q as text) is null or search_norm like '%' || ops.norm(:q) || '%') and (:staff or linked_account_id=:a) and (cast(:cursor_name as text) is null or (full_name_en,id)>(:cursor_name,:cursor_id)) order by full_name_en,id`,
    [
      uuid("c", scope.audit.companyId),
      uuid("a", scope.audit.accountId),
      param("q", query.q ?? null),
      param("staff", staff),
      param("cursor_name", cursor?.name ?? null),
      uuid("cursor_id", cursor?.id ?? null),
    ],
  );
  const items: z.infer<typeof ownerListItemSchema>[] = [];
  for (const row of records) {
    const item = listItem(await ownerDetail(scope, row));
    if (matches(item, query)) items.push(item);
    if (items.length > query.limit) break;
  }
  const more = items.length > query.limit;
  const page = items.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page,
    nextCursor: more && last ? encodeCursor(last.fullName.en, last.id) : null,
  };
}
