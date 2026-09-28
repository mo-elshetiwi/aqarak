import type { Parameter, Row } from "@aqarak/db/data-api";
import {
  bankSchema,
  createOwnerSchema,
  mandateSchema,
  updateOwnerSchema,
} from "../properties/lib/schemas";
import { fail } from "../properties/lib/problem";
import {
  checkVersion,
  rows,
  uuid,
  text,
  number,
  one,
} from "../properties/lib/sql";
import { insert, update, auditRow } from "../properties/lib/mutations";
import type { RequestScope } from "../properties/lib/runtime";
import type { CommandResponse } from "../properties/lib/idempotency";
import { ownerSummary, activeMandate } from "./read";
async function linkSelfManaged(scope: RequestScope): Promise<void> {
  const prior = (
    await rows(
      scope.tx,
      "select * from core.account_company_link where company_id=:c and account_id=:a and kind='owner'",
      [uuid("c", scope.audit.companyId), uuid("a", scope.audit.accountId)],
    )
  )[0];
  if (prior?.status === "active") return;
  const link = prior
    ? await update(
        scope,
        "core.account_company_link",
        { id: text(prior, "id"), expected: number(prior, "version") },
        { status: "active" },
      )
    : await insert(scope, "core.account_company_link", {
        account_id: scope.audit.accountId,
        kind: "owner",
        status: "active",
      });
  await auditRow(scope, {
    row: link,
    type: prior
      ? "account_company_link.updated"
      : "account_company_link.created",
    ...(prior ? { before: number(prior, "version"), fields: ["status"] } : {}),
  });
}
export async function createOwner(
  scope: RequestScope,
  input: unknown,
): Promise<CommandResponse> {
  const body = createOwnerSchema.parse(input);
  if (body.selfManaged) {
    if (scope.company.kind !== "self_managed_owner")
      fail(422, "SELF_MANAGED_NOT_ALLOWED");
    if (
      (
        await rows(
          scope.tx,
          "select id from party.owner where company_id=:c and self_managed",
          [uuid("c", scope.audit.companyId)],
        )
      ).length
    )
      fail(422, "SELF_MANAGED_OWNER_EXISTS");
  }
  const owner = await insert(scope, "party.owner", {
    full_name_en: body.fullName.en,
    full_name_ar: body.fullName.ar,
    email: body.email ?? null,
    phone_e164: body.phoneE164 ?? null,
    preferred_language: body.preferredLanguage,
    eid_number: body.eidNumber ?? null,
    passport_no: body.passportNo ?? null,
    self_managed: body.selfManaged ?? false,
    linked_account_id: body.selfManaged ? scope.audit.accountId : null,
  });
  await auditRow(scope, { row: owner, type: "owner.created" });
  if (body.selfManaged) await linkSelfManaged(scope);
  return { status: 201, body: { owner: ownerSummary(owner) } };
}
export async function editOwner(
  scope: RequestScope,
  input: unknown,
): Promise<CommandResponse> {
  const body = updateOwnerSchema.parse(input);
  const prior = one(scope.root ? [scope.root] : []);
  if (
    scope.audit.role === "owner" &&
    Object.keys(body).some(
      (key) =>
        !["expectedVersion", "phoneE164", "preferredLanguage"].includes(key),
    )
  )
    fail(403, "FORBIDDEN");
  checkVersion(prior, body.expectedVersion);
  const fields: Record<string, Parameter["value"]> = {};
  if (body.fullName) {
    fields.full_name_en = body.fullName.en;
    fields.full_name_ar = body.fullName.ar;
  }
  const mapping = {
    email: "email",
    phoneE164: "phone_e164",
    preferredLanguage: "preferred_language",
    eidNumber: "eid_number",
    passportNo: "passport_no",
  } as const;
  for (const [key, column] of Object.entries(mapping)) {
    const value = body[key as keyof typeof mapping];
    if (value !== undefined) fields[column] = value;
  }
  const owner = await update(
    scope,
    "party.owner",
    { id: text(prior, "id"), expected: body.expectedVersion },
    fields,
  );
  await auditRow(scope, {
    row: owner,
    type: "owner.updated",
    before: body.expectedVersion,
    fields: Object.keys(fields),
  });
  return { status: 200, body: { owner: ownerSummary(owner) } };
}
export async function bankDetails(
  scope: RequestScope,
  input: unknown,
): Promise<CommandResponse> {
  const body = bankSchema.parse(input);
  const prior = one(scope.root ? [scope.root] : []);
  checkVersion(prior, body.expectedVersion);
  const fields = {
    bank_name: body.bankName,
    account_holder: body.accountHolder,
    iban: body.iban,
  };
  const owner = await update(
    scope,
    "party.owner",
    { id: text(prior, "id"), expected: body.expectedVersion },
    fields,
  );
  await auditRow(scope, {
    row: owner,
    type: "owner.updated",
    before: body.expectedVersion,
    fields: Object.keys(fields),
  });
  return { status: 200, body: { owner: ownerSummary(owner) } };
}
async function synchroniseProperties(
  scope: RequestScope,
  mandate: Row,
  ids: string[],
): Promise<void> {
  const existing = await rows(
    scope.tx,
    "select * from estate.mandate_property where company_id=:c and mandate_id=:id",
    [uuid("c", scope.audit.companyId), uuid("id", text(mandate, "id"))],
  );
  for (const old of existing) {
    const status = ids.includes(text(old, "property_id"))
      ? "active"
      : "removed";
    if (old.status === status) continue;
    const changed = await update(
      scope,
      "estate.mandate_property",
      { id: text(old, "id"), expected: number(old, "version") },
      { status },
    );
    await auditRow(scope, {
      row: changed,
      type: "mandate_property.updated",
      before: number(old, "version"),
      fields: ["status"],
    });
  }
  for (const id of ids.filter(
    (id) => !existing.some((row) => row.property_id === id),
  )) {
    const link = await insert(scope, "estate.mandate_property", {
      mandate_id: text(mandate, "id"),
      property_id: id,
      status: "active",
    });
    await auditRow(scope, { row: link, type: "mandate_property.created" });
  }
}
export async function putMandate(
  scope: RequestScope,
  input: unknown,
): Promise<CommandResponse> {
  const body = mandateSchema.parse(input);
  const owner = text(one(scope.root ? [scope.root] : []), "id");
  const prior = await activeMandate(scope, owner);
  if (
    (prior === null && body.expectedVersion !== null) ||
    (prior !== null && body.expectedVersion !== prior.version)
  )
    fail(409, "VERSION_CONFLICT");
  if (prior && prior.ownerGate !== body.ownerGate && !body.reason)
    fail(422, "REASON_REQUIRED", "reason");
  for (const id of body.propertyIds)
    if (
      !(
        await rows(
          scope.tx,
          "select id from estate.ownership where company_id=:c and owner_id=:owner and property_id=:property",
          [
            uuid("c", scope.audit.companyId),
            uuid("owner", owner),
            uuid("property", id),
          ],
        )
      ).length
    )
      fail(422, "PROPERTY_NOT_OWNED", "propertyIds");
  const fields = mandateFields(body);
  const mandate = prior
    ? await update(
        scope,
        "estate.owner_mandate",
        { id: prior.id, expected: prior.version },
        fields,
      )
    : await insert(scope, "estate.owner_mandate", {
        ...fields,
        owner_id: owner,
        status: "active",
      });
  await auditRow(scope, {
    row: mandate,
    type: prior ? "owner_mandate.updated" : "owner_mandate.created",
    ...(prior ? { before: prior.version, fields: Object.keys(fields) } : {}),
    ...(body.reason ? { reason: body.reason } : {}),
  });
  await synchroniseProperties(scope, mandate, body.propertyIds);
  return { status: 200, body: { mandate: await activeMandate(scope, owner) } };
}

function mandateFields(
  body: import("zod").z.infer<typeof mandateSchema>,
): Record<string, Parameter["value"]> {
  return {
    owner_gate: body.ownerGate,
    cost_threshold_fils: body.costThresholdFils,
    emergency_limit_fils: body.emergencyLimitFils ?? null,
    fee_bp: body.feeBp ?? null,
    starts_on: body.startsOn,
    ends_on: body.endsOn,
  };
}
