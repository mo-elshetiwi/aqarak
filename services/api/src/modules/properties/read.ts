import type { Row } from "@aqarak/db/data-api";
import { companyKind, propertyId, unitStatus } from "./lib/domain";
import type { z } from "zod";
import type { RequestScope } from "./lib/runtime";
import { rows, uuid, param, text, number, nullableText, bool } from "./lib/sql";
import { gate, today } from "./lib/gate";
import { documents, history } from "./lib/read-model";
import { paginationSchema } from "./lib/schemas";
import {
  propertySummarySchema,
  propertyDetailSchema,
  propertyListItemSchema,
  unitItemSchema,
} from "./schemas";
import {
  activeMandate,
  gateMandate,
  decodeCursor,
  encodeCursor,
} from "../owners/read";
export function propertySummary(
  row: Row,
): z.infer<typeof propertySummarySchema> {
  return {
    id: text(row, "id"),
    version: number(row, "version"),
    name: { en: text(row, "name_en"), ar: text(row, "name_ar") },
  };
}
export function unitItem(row: Row): z.infer<typeof unitItemSchema> {
  return unitItemSchema.parse({
    id: text(row, "id"),
    version: number(row, "version"),
    unitNo: text(row, "unit_no"),
    untNumber: nullableText(row, "unt_number"),
    use: row.use,
    kind: row.kind,
    bedrooms: row.bedrooms == null ? null : number(row, "bedrooms"),
    areaSqm: nullableText(row, "area_sqm"),
    status: row.status,
    blockReason: nullableText(row, "block_reason"),
  });
}
export async function propertyDetail(
  scope: RequestScope,
  row: Row,
): Promise<z.infer<typeof propertyDetailSchema>> {
  const id = text(row, "id");
  const params = [uuid("c", scope.audit.companyId), uuid("id", id)];
  const owners = await rows(
    scope.tx,
    "select o.id,o.full_name_en,o.full_name_ar,s.is_representative from party.owner o join estate.ownership s on s.company_id=o.company_id and s.owner_id=o.id where s.company_id=:c and s.property_id=:id order by s.is_representative desc,o.id",
    params,
  );
  const mandate = owners[0]
    ? await activeMandate(scope, text(owners[0], "id"))
    : null;
  const units = (
    await rows(
      scope.tx,
      "select * from estate.unit where company_id=:c and property_id=:id order by unit_no,id",
      params,
    )
  ).map(unitItem);
  const unitsByStatus = Object.fromEntries(
    unitStatus.options.map((status) => [
      status,
      units.filter((unit) => unit.status === status).length,
    ]),
  ) as Record<z.infer<typeof unitStatus>, number>;
  const docs = await documents(scope.tx, {
    companyId: scope.audit.companyId,
    type: "property",
    id,
  });
  const title = docs.find((doc) => doc.docType === "title_deed");
  const titleVersion = title?.current ?? title?.latest;
  const staff = scope.actor.roles.some((role) =>
    ["manager", "accountant", "company_administrator"].includes(role),
  );
  const ownerGateOverride =
    row.owner_gate_override == null ? null : bool(row, "owner_gate_override");
  return propertyDetailSchema.parse({
    ...propertySummary(row),
    kind: row.kind,
    area:
      row.area_en == null && row.area_ar == null
        ? null
        : {
            en: nullableText(row, "area_en"),
            ar: nullableText(row, "area_ar"),
          },
    use: row.use,
    owners: owners.map((owner) => ({
      id: text(owner, "id"),
      fullName: {
        en: text(owner, "full_name_en"),
        ar: text(owner, "full_name_ar"),
      },
    })),
    unitCount: units.length,
    unitsByStatus,
    titleDeed: titleVersion
      ? {
          reviewStatus: titleVersion.reviewStatus,
          processingStatus: titleVersion.processingStatus,
        }
      : null,
    ownerGate: gate(
      {
        kind: companyKind.parse(scope.company.kind),
        defaultOwnerGate: bool(scope.company, "default_owner_gate"),
      },
      { id: propertyId.parse(id), ownerGateOverride },
      gateMandate(mandate),
      today(),
    ),
    plotNo: nullableText(row, "plot_no"),
    titleDeedNo: nullableText(row, "title_deed_no"),
    prpNumber: nullableText(row, "prp_number"),
    onwaniAddress: nullableText(row, "onwani_address"),
    zone: nullableText(row, "zone"),
    ownerGateOverride,
    documents: docs,
    units,
    history: staff
      ? await history(scope.tx, {
          companyId: scope.audit.companyId,
          type: "property",
          id,
        })
      : [],
  });
}
export async function listProperties(
  scope: RequestScope,
  input: unknown,
): Promise<{
  items: z.infer<typeof propertyListItemSchema>[];
  nextCursor: string | null;
}> {
  const query = paginationSchema.parse(input);
  const cursor = decodeCursor(query.cursor);
  const staff = scope.actor.roles.some((role) =>
    ["manager", "accountant", "company_administrator"].includes(role),
  );
  const records = await rows(
    scope.tx,
    `select p.* from estate.property p where p.company_id=:c and (cast(:q as text) is null or p.search_norm like '%' || ops.norm(:q) || '%') and (cast(:cursor_name as text) is null or (p.name_en,p.id)>(:cursor_name,:cursor_id)) and (:staff or (:owner and exists(select 1 from estate.ownership s join party.owner o on o.company_id=s.company_id and o.id=s.owner_id where s.company_id=:c and s.property_id=p.id and o.linked_account_id=:a)) or (:tenant and exists(select 1 from lease.contract ct join party.tenant t on t.company_id=ct.company_id and t.id=ct.tenant_id join lease.contract_unit cu on cu.company_id=ct.company_id and cu.contract_id=ct.id join estate.unit u on u.company_id=cu.company_id and u.id=cu.unit_id where ct.company_id=:c and u.property_id=p.id and t.linked_account_id=:a))) order by p.name_en,p.id limit :limit`,
    [
      uuid("c", scope.audit.companyId),
      uuid("a", scope.audit.accountId),
      param("q", query.q ?? null),
      param("staff", staff),
      param("owner", scope.actor.roles.includes("owner")),
      param("tenant", scope.actor.roles.includes("tenant")),
      param("cursor_name", cursor?.name ?? null),
      uuid("cursor_id", cursor?.id ?? null),
      param("limit", query.limit + 1),
    ],
  );
  const items: z.infer<typeof propertyListItemSchema>[] = [];
  for (const row of records.slice(0, query.limit))
    items.push(propertyListItemSchema.parse(await propertyDetail(scope, row)));
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      records.length > query.limit && last
        ? encodeCursor(last.name.en, last.id)
        : null,
  };
}
