import type { Parameter } from "@aqarak/db/data-api";
import type { z } from "zod";
import { transitionUnit, unitStatus } from "./lib/domain";
import type { RequestScope } from "./lib/runtime";
import type { CommandResponse } from "./lib/idempotency";
import { fail } from "./lib/problem";
import { rows, uuid, param, one, text, checkVersion } from "./lib/sql";
import { insert, update, auditRow } from "./lib/mutations";
import {
  createPropertySchema,
  updatePropertySchema,
  bulkUnitsSchema,
  unitInputSchema,
  updateUnitSchema,
  unitStatusSchema,
} from "./schemas";
import { propertySummary, unitItem } from "./read";
async function uniquePrp(
  scope: RequestScope,
  value: string | undefined,
  except: string | null,
): Promise<void> {
  if (value === undefined) return;
  if (
    (
      await rows(
        scope.tx,
        "select id from estate.property where company_id=:c and prp_number=:prp and (cast(:except as uuid) is null or id<>:except)",
        [
          uuid("c", scope.audit.companyId),
          param("prp", value),
          uuid("except", except),
        ],
      )
    ).length
  )
    fail(422, "PRP_NUMBER_TAKEN", "prpNumber");
}
export async function createProperty(
  scope: RequestScope,
  input: unknown,
): Promise<CommandResponse> {
  const body = createPropertySchema.parse(input);
  if (
    !(
      await rows(
        scope.tx,
        "select id from party.owner where company_id=:c and id=:owner",
        [uuid("c", scope.audit.companyId), uuid("owner", body.ownerId)],
      )
    ).length
  )
    fail(422, "OWNER_NOT_FOUND", "ownerId");
  await uniquePrp(scope, body.prpNumber, null);
  const property = await insert(scope, "estate.property", {
    name_en: body.name.en,
    name_ar: body.name.ar,
    kind: body.kind,
    area_en: body.area?.en ?? null,
    area_ar: body.area?.ar ?? null,
    plot_no: body.plotNo ?? null,
    title_deed_no: body.titleDeedNo ?? null,
    prp_number: body.prpNumber ?? null,
    onwani_address: body.onwaniAddress ?? null,
    zone: body.zone ?? null,
    use: body.use,
    owner_gate_override: body.ownerGateOverride,
  });
  await auditRow(scope, { row: property, type: "property.created" });
  const ownership = await insert(scope, "estate.ownership", {
    owner_id: body.ownerId,
    property_id: text(property, "id"),
    share_bp: 10000,
    is_representative: true,
  });
  await auditRow(scope, { row: ownership, type: "ownership.created" });
  return { status: 201, body: { property: propertySummary(property) } };
}
function propertyFields(
  body: z.infer<typeof updatePropertySchema>,
): Record<string, Parameter["value"]> {
  const fields: Record<string, Parameter["value"]> = {};
  if (body.name) {
    fields.name_en = body.name.en;
    fields.name_ar = body.name.ar;
  }
  if (body.area) {
    fields.area_en = body.area.en;
    fields.area_ar = body.area.ar;
  }
  const mapping = {
    plotNo: "plot_no",
    titleDeedNo: "title_deed_no",
    prpNumber: "prp_number",
    onwaniAddress: "onwani_address",
    zone: "zone",
    use: "use",
    ownerGateOverride: "owner_gate_override",
  } as const;
  for (const [key, column] of Object.entries(mapping)) {
    const value = body[key as keyof typeof mapping];
    if (value !== undefined) fields[column] = value;
  }
  return fields;
}
export async function editProperty(
  scope: RequestScope,
  input: unknown,
): Promise<CommandResponse> {
  const body = updatePropertySchema.parse(input);
  const prior = one(scope.root ? [scope.root] : []);
  checkVersion(prior, body.expectedVersion);
  if (
    body.ownerGateOverride !== undefined &&
    body.ownerGateOverride !== prior.owner_gate_override &&
    !body.reason
  )
    fail(422, "REASON_REQUIRED", "reason");
  await uniquePrp(scope, body.prpNumber, text(prior, "id"));
  const fields = propertyFields(body);
  const row = await update(
    scope,
    "estate.property",
    { id: text(prior, "id"), expected: body.expectedVersion },
    fields,
  );
  await auditRow(scope, {
    row,
    type: "property.updated",
    before: body.expectedVersion,
    fields: Object.keys(fields),
    ...(body.reason ? { reason: body.reason } : {}),
  });
  return { status: 200, body: { property: propertySummary(row) } };
}
function unitFields(body: {
  [K in keyof z.infer<typeof unitInputSchema>]?:
    z.infer<typeof unitInputSchema>[K] | undefined;
}): Record<string, Parameter["value"]> {
  const fields: Record<string, Parameter["value"]> = {};
  const mapping = {
    unitNo: "unit_no",
    untNumber: "unt_number",
    use: "use",
    kind: "kind",
    bedrooms: "bedrooms",
    areaSqm: "area_sqm",
  } as const;
  for (const [key, column] of Object.entries(mapping)) {
    const value = body[key as keyof typeof mapping];
    if (value !== undefined) fields[column] = value;
  }
  return fields;
}
async function uniqueUnit(
  scope: RequestScope,
  input: {
    unitNo?: string | undefined;
    untNumber?: string | undefined;
    except: string | null;
    index?: number;
  },
): Promise<void> {
  const property = text(one(scope.root ? [scope.root] : []), "id");
  const found = await rows(
    scope.tx,
    "select unit_no,unt_number,property_id from estate.unit where company_id=:c and (cast(:except as uuid) is null or id<>:except) and ((property_id=:property and unit_no=:no) or unt_number=:unt)",
    [
      uuid("c", scope.audit.companyId),
      uuid("except", input.except),
      uuid("property", property),
      param("no", input.unitNo ?? null),
      param("unt", input.untNumber ?? null),
    ],
  );
  const prefix =
    input.index === undefined ? "" : `units[${String(input.index)}].`;
  if (
    found.some(
      (row) => row.property_id === property && row.unit_no === input.unitNo,
    )
  )
    fail(422, "UNIT_NUMBER_TAKEN", `${prefix}unitNo`);
  if (found.some((row) => row.unt_number === input.untNumber))
    fail(422, "UNT_NUMBER_TAKEN", `${prefix}untNumber`);
}
function checkRequestDuplicates(
  units: z.infer<typeof unitInputSchema>[],
): void {
  const numbers = new Set<string>();
  const unts = new Set<string>();
  units.forEach((unit, index) => {
    if (numbers.has(unit.unitNo))
      fail(422, "UNIT_NUMBER_TAKEN", `units[${String(index)}].unitNo`);
    numbers.add(unit.unitNo);
    if (unit.untNumber) {
      if (unts.has(unit.untNumber))
        fail(422, "UNT_NUMBER_TAKEN", `units[${String(index)}].untNumber`);
      unts.add(unit.untNumber);
    }
  });
}
export async function addUnits(
  scope: RequestScope,
  input: unknown,
): Promise<CommandResponse> {
  const body = bulkUnitsSchema.parse(input);
  checkRequestDuplicates(body.units);
  for (const [index, unit] of body.units.entries())
    await uniqueUnit(scope, { ...unit, except: null, index });
  const units = [];
  for (const unit of body.units) {
    const row = await insert(scope, "estate.unit", {
      ...unitFields(unit),
      property_id: text(one(scope.root ? [scope.root] : []), "id"),
      status: "vacant",
    });
    await auditRow(scope, { row, type: "unit.created" });
    units.push(unitItem(row));
  }
  return { status: 201, body: { units } };
}
async function targetUnit(
  scope: RequestScope,
): Promise<import("@aqarak/db/data-api").Row> {
  return one(
    await rows(
      scope.tx,
      "select * from estate.unit where company_id=:c and property_id=:property and id=:id for update",
      [
        uuid("c", scope.audit.companyId),
        uuid("property", text(one(scope.root ? [scope.root] : []), "id")),
        uuid("id", scope.params.unitId ?? null),
      ],
    ),
  );
}
export async function editUnit(
  scope: RequestScope,
  input: unknown,
): Promise<CommandResponse> {
  const body = updateUnitSchema.parse(input);
  const prior = await targetUnit(scope);
  checkVersion(prior, body.expectedVersion);
  await uniqueUnit(scope, { ...body, except: text(prior, "id") });
  const fields = unitFields(body);
  const row = await update(
    scope,
    "estate.unit",
    { id: text(prior, "id"), expected: body.expectedVersion },
    fields,
  );
  await auditRow(scope, {
    row,
    type: "unit.updated",
    before: body.expectedVersion,
    fields: Object.keys(fields),
  });
  return { status: 200, body: { unit: unitItem(row) } };
}
export async function changeUnitStatus(
  scope: RequestScope,
  input: unknown,
): Promise<CommandResponse> {
  const body = unitStatusSchema.parse(input);
  const prior = await targetUnit(scope);
  checkVersion(prior, body.expectedVersion);
  const command =
    body.command === "block"
      ? { type: "block" as const, reason: body.blockReason ?? null }
      : { type: body.command };
  const decision = transitionUnit(unitStatus.parse(prior.status), command);
  if (!decision.ok) fail(409, "INVALID_TRANSITION");
  const fields = {
    status: decision.value,
    block_reason: body.command === "block" ? (body.blockReason ?? null) : null,
  };
  const row = await update(
    scope,
    "estate.unit",
    { id: text(prior, "id"), expected: body.expectedVersion },
    fields,
  );
  await auditRow(scope, {
    row,
    type: `unit.${decision.value}`,
    before: body.expectedVersion,
    fields: Object.keys(fields),
    reason: body.reason,
  });
  return { status: 200, body: { unit: unitItem(row) } };
}
