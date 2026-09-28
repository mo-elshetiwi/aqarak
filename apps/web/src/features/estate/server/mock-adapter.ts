/** All names, identifiers, emails and records in this file are synthetic development fixtures. */
import { z } from "zod";
import { err, ok, unitTransitions, type Result } from "@aqarak/domain";
import { getApi } from "@/lib/api";
import type { AqarakApi, CompanyContext } from "@/lib/api/contract";
import {
  MOCK_COMPANY_A_ID,
  MOCK_COMPANY_B_ID,
  MOCK_PARTY_IDS,
} from "@/lib/api/mock-fixtures";
import * as c from "../contract";
import type { EstateApi } from "./estate-api";
import { bindApi } from "./bind";
import { routes, type Input, type Output, type RouteName } from "./routes";

interface Store {
  owners: Record<string, c.OwnerDetail[]>;
  properties: Record<string, c.PropertyDetail[]>;
  replays: Map<string, { fingerprint: string; result: unknown }>;
}
const id = () => crypto.randomUUID();
const counts = (): c.PropertyListItem["unitsByStatus"] => ({
  vacant: 0,
  listed: 0,
  reserved: 0,
  occupied: 0,
  notice_given: 0,
  under_maintenance: 0,
  blocked: 0,
});
const gate = (owner: c.OwnerDetail): c.OwnerDetail["ownerGate"] =>
  owner.selfManaged
    ? { value: false, recorded: true, source: "self_managed" }
    : {
        value: owner.mandate?.ownerGate ?? true,
        recorded: owner.mandate?.ownerGate != null,
        source:
          owner.mandate?.ownerGate == null ? "company_default" : "mandate",
      };
function makeOwner(
  ownerId: string,
  en: string,
  ar: string,
  selfManaged = false,
): c.OwnerDetail {
  return {
    id: ownerId,
    version: 1,
    fullName: { en, ar },
    email: null,
    phoneE164: null,
    preferredLanguage: "en",
    eidNumberMasked: null,
    passportNoMasked: null,
    selfManaged,
    linked: selfManaged,
    bank: null,
    mandate: null,
    ownerGate: {
      value: !selfManaged,
      recorded: selfManaged,
      source: selfManaged ? "self_managed" : "company_default",
    },
    properties: [],
    documents: [],
    onboarding: {
      status: "incomplete",
      missing: [
        "emirates_id",
        "management_agreement",
        "tawtheeq_authorisation",
      ],
    },
    invitation: null,
    history: [],
  };
}
function makeDocument(
  docType: c.DocumentItem["docType"],
  expiryDate: string | null = null,
): c.DocumentItem {
  const version: c.VersionItem = {
    versionId: id(),
    version: 1,
    versionNo: 1,
    processingStatus: "scan_clean",
    reviewStatus: "accepted",
    issueDate: "2026-01-01",
    expiryDate,
    validity: expiryDate ? "valid" : null,
    rejectReason: null,
    scanResult: null,
  };
  return { documentId: id(), docType, current: version, latest: version };
}
export function createEstateMockStore(): Store {
  const khalid = makeOwner(
    MOCK_PARTY_IDS["owner-1"],
    "Khalid Al Suwaidi",
    "خالد السويدي",
  );
  khalid.mandate = {
    id: id(),
    version: 1,
    ownerGate: true,
    costThresholdFils: "200000",
    feeBp: 500,
    startsOn: "2026-01-01",
    endsOn: "2026-12-31",
    status: "active",
    propertyIds: [],
  };
  khalid.documents = [
    makeDocument("management_agreement", "2026-12-31"),
    makeDocument("tawtheeq_authorisation", "2027-06-30"),
  ];
  khalid.onboarding.status = "pending_review";
  const mariam = makeOwner(
    MOCK_PARTY_IDS["owner-2-a"],
    "Mariam Al Nuaimi",
    "مريم النعيمي",
  );
  mariam.mandate = { ...khalid.mandate, id: id(), ownerGate: false };
  mariam.onboarding = { status: "verified", missing: [] };
  mariam.documents = [
    makeDocument("emirates_id", "2028-01-01"),
    makeDocument("management_agreement", "2027-01-01"),
    makeDocument("tawtheeq_authorisation", "2027-06-30"),
  ];
  const saeed = makeOwner(id(), "Saeed Al Mazrouei", "سعيد المزروعي");
  const fatima = makeOwner(id(), "Fatima Al Hammadi", "فاطمة الحمادي");
  fatima.onboarding.status = "invited";
  fatima.invitation = {
    id: id(),
    status: "pending",
    expiresAt: "2027-01-01T00:00:00.000Z",
  };
  const self = makeOwner(
    MOCK_PARTY_IDS["owner-2-b"],
    "Mariam Al Nuaimi",
    "مريم النعيمي",
    true,
  );
  const property: c.PropertyDetail = {
    id: id(),
    version: 1,
    name: { en: "Al Waha Residence, Building 7", ar: "مبنى الواحة السكني 7" },
    kind: "building",
    area: { en: "MBZ City", ar: "مدينة محمد بن زايد" },
    use: "residential",
    owners: [{ id: khalid.id, fullName: khalid.fullName }],
    unitCount: 12,
    unitsByStatus: counts(),
    titleDeed: { reviewStatus: "accepted", processingStatus: "scan_clean" },
    ownerGate: { value: true, source: "mandate" },
    plotNo: "C-12-3-45",
    titleDeedNo: "SYNTHETIC-TD-7",
    prpNumber: "PRP-P1",
    onwaniAddress: null,
    zone: "MBZ City, sector 12",
    ownerGateOverride: null,
    documents: [makeDocument("title_deed")],
    units: Array.from({ length: 12 }, (_, index) => ({
      id: id(),
      version: 1,
      unitNo: String(101 + index),
      untNumber: `SYNTHETIC-UNT-${String(101 + index)}`,
      use: "residential",
      kind: "apartment",
      bedrooms: 2,
      areaSqm: "95.00",
      status: c.unitStatusSchema.options[index % 7] ?? "vacant",
      blockReason: index % 7 === 6 ? "owner_use" : null,
    })),
    history: [],
  };
  khalid.properties = [{ id: property.id, name: property.name, unitCount: 12 }];
  khalid.mandate.propertyIds = [property.id];
  for (const unit of property.units) property.unitsByStatus[unit.status]++;
  for (const owner of [khalid, mariam, saeed, fatima, self])
    owner.ownerGate = gate(owner);
  return {
    owners: {
      [MOCK_COMPANY_A_ID]: [khalid, mariam, saeed, fatima],
      [MOCK_COMPANY_B_ID]: [self],
    },
    properties: { [MOCK_COMPANY_A_ID]: [property], [MOCK_COMPANY_B_ID]: [] },
    replays: new Map(),
  };
}
const globals = globalThis as typeof globalThis & { estateMockStore?: Store };
function fail(
  code: c.EstateProblemCode,
  status = 422,
  field?: string,
): Result<never, c.EstateProblem> {
  return err({ code, status, ...(field ? { field } : {}) });
}
function refresh(store: Store, company: string) {
  const owners = store.owners[company] ?? [];
  for (const owner of owners) owner.ownerGate = gate(owner);
  for (const property of store.properties[company] ?? []) {
    property.unitCount = property.units.length;
    property.unitsByStatus = counts();
    for (const unit of property.units) property.unitsByStatus[unit.status]++;
    const owner = owners.find((o) =>
      property.owners.some((link) => link.id === o.id),
    );
    if (owner) {
      property.owners = [{ id: owner.id, fullName: owner.fullName }];
      property.ownerGate = owner.selfManaged
        ? { value: false, source: "self_managed" }
        : property.ownerGateOverride !== null
          ? { value: property.ownerGateOverride, source: "property_override" }
          : { value: owner.ownerGate.value, source: owner.ownerGate.source };
    }
    const deed = property.documents.find((d) => d.docType === "title_deed");
    const current = deed?.current ?? deed?.latest;
    property.titleDeed = current
      ? {
          reviewStatus: current.reviewStatus,
          processingStatus: current.processingStatus,
        }
      : null;
  }
  for (const owner of owners)
    owner.properties = (store.properties[company] ?? [])
      .filter((p) => p.owners.some((o) => o.id === owner.id))
      .map((p) => ({ id: p.id, name: p.name, unitCount: p.unitCount }));
}
function summary(owner: c.OwnerDetail): c.OwnerListItem {
  const document = (type: c.DocumentItem["docType"]) => {
    const doc = owner.documents.find((d) => d.docType === type);
    const version = doc?.current ?? doc?.latest;
    return doc && version
      ? {
          documentId: doc.documentId,
          reviewStatus: version.reviewStatus,
          expiryDate: version.expiryDate,
          validity: version.validity,
        }
      : null;
  };
  return {
    ...owner,
    managementAgreement: document("management_agreement"),
    tawtheeqAuthorisation: document("tawtheeq_authorisation"),
    onboarding: owner.onboarding.status,
  };
}
function page<T>(items: T[], input: c.PropertyQuery) {
  const start = Number(input.cursor ?? 0);
  const limit = input.limit ?? 100;
  return {
    items: items.slice(start, start + limit),
    nextCursor: start + limit < items.length ? String(start + limit) : null,
  };
}
export function createEstateMockApi(
  options: { store?: Store; getMe?: AqarakApi["getMe"] } = {},
): EstateApi {
  const store =
    options.store ?? (globals.estateMockStore ??= createEstateMockStore());
  const getMe = options.getMe ?? ((session: string) => getApi().getMe(session));
  async function execute<K extends RouteName>(
    name: K,
    ...args: [
      sessionId: string,
      companyId: string,
      input: Input<K>,
      ids?: string[],
      key?: string,
    ]
  ): Promise<Result<Output<K>, c.EstateProblem>> {
    const [sessionId, companyId, input, ids = [], key] = args;
    const me = await getMe(sessionId);
    if (!me.ok)
      return fail(
        me.error.code === "SESSION_INVALID" ? "SESSION_INVALID" : "UNAVAILABLE",
        me.error.status,
      );
    const context = me.value.contexts.find((v) => v.companyId === companyId);
    if (!context) return fail("NOT_FOUND", 404);
    if (!mayRead(context, name, ids[0])) return fail("FORBIDDEN", 403);
    const parsed = routes[name].input.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error);
    const command = routes[name].method !== "GET";
    if (command && !c.keySchema.safeParse(key).success)
      return fail("VALIDATION_FAILED", 422, "idempotencyKey");
    const replayKey = `${sessionId}:${companyId}:${String(key)}`;
    const fingerprint = JSON.stringify([name, ids, parsed.data]);
    const replay = command ? store.replays.get(replayKey) : undefined;
    if (replay)
      return replay.fingerprint === fingerprint
        ? ok(structuredClone(replay.result) as Output<K>)
        : fail("IDEMPOTENCY_KEY_REUSED", 409);
    refresh(store, companyId);
    const result = dispatch(name, companyId, {
      raw: parsed.data,
      ids,
      context,
    });
    if (!result.ok) return result;
    refresh(store, companyId);
    const output = (routes[name].output as z.ZodType<Output<K>>).safeParse(
      result.value,
    );
    if (!output.success) return fail("UNAVAILABLE", 503);
    if (command)
      store.replays.set(replayKey, {
        fingerprint,
        result: structuredClone(output.data),
      });
    return ok(structuredClone(output.data));
  }
  function dispatch(
    name: RouteName,
    company: string,
    args: { raw: unknown; ids: string[]; context: CompanyContext },
  ): Result<unknown, c.EstateProblem> {
    const { raw, ids, context } = args;
    const owners = (store.owners[company] ??= []);
    const properties = (store.properties[company] ??= []);
    const owner = owners.find((o) => o.id === ids[0]);
    const property = properties.find((p) => p.id === ids[0]);
    const ownerRoute = [
      "getOwner",
      "updateOwner",
      "putMandate",
      "putBankDetails",
      "inviteOwner",
      "requestOwnerUpload",
      "checkOwnerDocument",
      "acceptOwnerDocument",
      "rejectOwnerDocument",
    ].includes(name);
    if (ownerRoute && !owner) return fail("NOT_FOUND", 404);
    if (
      ![
        "listOwners",
        "createOwner",
        "listProperties",
        "createProperty",
      ].includes(name) &&
      !ownerRoute &&
      !property
    )
      return fail("NOT_FOUND", 404);
    const expected = z
      .object({ expectedVersion: c.versionSchema.nullable() })
      .safeParse(raw);
    if (versionConflict(name, { owner, property, ids, expected }))
      return fail("VERSION_CONFLICT", 409);
    const documentCommand = (): Result<unknown, c.EstateProblem> => {
      const record = ownerRoute ? owner : property;
      if (!record) return fail("NOT_FOUND", 404);
      if (name.startsWith("request"))
        return requestUpload(record, raw, company);
      const doc = record.documents.find((d) => d.documentId === ids[1]);
      const version = doc?.latest;
      if (!doc || !version || version.versionId !== ids[2])
        return fail("NOT_FOUND", 404);
      if (name.startsWith("check")) {
        version.processingStatus = "scan_clean";
        version.version++;
        return ok({ version, scanPending: false });
      }
      if (expected.success && expected.data.expectedVersion !== version.version)
        return fail("VERSION_CONFLICT", 409);
      if (name.startsWith("accept")) {
        const accepted = acceptVersion(doc, version, raw);
        if (!accepted.ok) return accepted;
      } else {
        version.reviewStatus = "rejected";
        version.rejectReason = c.rejectInputSchema.parse(raw).reason;
      }
      version.version++;
      return ok({ version });
    };
    const handlers: Record<RouteName, () => Result<unknown, c.EstateProblem>> =
      {
        listOwners: () => {
          const input = c.ownerQuerySchema.parse(raw);
          const q = input.q?.toLowerCase();
          return ok(
            page(
              owners
                .map(summary)
                .filter(
                  (o) =>
                    (!q ||
                      `${o.fullName.en} ${o.fullName.ar}`
                        .toLowerCase()
                        .includes(q)) &&
                    (!input.onboarding || o.onboarding === input.onboarding) &&
                    (!input.gate ||
                      (input.gate === "not_recorded"
                        ? !o.ownerGate.recorded
                        : o.ownerGate.value === (input.gate === "on"))) &&
                    (input.mandateExpiring !== "true" ||
                      o.managementAgreement?.validity === "expiring_soon"),
                ),
              input,
            ),
          );
        },
        createOwner: () => {
          const input = c.createOwnerSchema.parse(raw);
          if (input.selfManaged && context.companyKind !== "self_managed_owner")
            return fail("SELF_MANAGED_NOT_ALLOWED");
          if (input.selfManaged && owners.some((o) => o.selfManaged))
            return fail("SELF_MANAGED_OWNER_EXISTS");
          const next = makeOwner(
            id(),
            input.fullName.en,
            input.fullName.ar,
            input.selfManaged,
          );
          Object.assign(next, {
            email: input.email ?? null,
            phoneE164: input.phoneE164 ?? null,
            preferredLanguage: input.preferredLanguage,
            eidNumberMasked: input.eidNumber
              ? `***********${input.eidNumber.slice(-4)}`
              : null,
            passportNoMasked: input.passportNo
              ? `****${input.passportNo.slice(-4)}`
              : null,
          });
          owners.push(next);
          return ok({ owner: next });
        },
        getOwner: () => {
          return ok(
            context.staffRoles.includes("manager")
              ? owner
              : { ...owner, history: [] },
          );
        },
        updateOwner: () => {
          if (!owner) return fail("NOT_FOUND", 404);
          const { expectedVersion, eidNumber, passportNo, ...fields } =
            c.updateOwnerSchema.parse(raw);
          Object.assign(owner, fields);
          if (eidNumber)
            owner.eidNumberMasked = `***********${eidNumber.slice(-4)}`;
          if (passportNo)
            owner.passportNoMasked = `****${passportNo.slice(-4)}`;
          owner.version = expectedVersion + 1;
          return ok({ owner });
        },
        putMandate: () => {
          if (!owner) return fail("NOT_FOUND", 404);
          const input = c.mandateInputSchema.parse(raw);
          if (
            owner.mandate &&
            owner.mandate.ownerGate !== input.ownerGate &&
            !input.reason
          )
            return fail("REASON_REQUIRED", 422, "reason");
          if (
            input.propertyIds.some(
              (p) =>
                !properties.some(
                  (v) => v.id === p && v.owners.some((o) => o.id === owner.id),
                ),
            )
          )
            return fail("PROPERTY_NOT_OWNED", 422, "propertyIds");
          owner.mandate = {
            id: owner.mandate?.id ?? id(),
            version: (owner.mandate?.version ?? 0) + 1,
            ownerGate: input.ownerGate,
            costThresholdFils: input.costThresholdFils,
            feeBp: input.feeBp ?? null,
            startsOn: input.startsOn,
            endsOn: input.endsOn,
            status: "active",
            propertyIds: input.propertyIds,
          };
          owner.history.unshift({
            eventType: "mandate_recorded",
            occurredAt: new Date().toISOString(),
            actorDisplayName: "Synthetic manager",
            actorRole: "manager",
            channel: "web_form",
            reason: input.reason ?? null,
          });
          return ok({ mandate: owner.mandate });
        },
        putBankDetails: () => {
          if (!owner) return fail("NOT_FOUND", 404);
          const input = c.bankInputSchema.parse(raw);
          owner.bank = {
            bankName: input.bankName,
            accountHolder: input.accountHolder,
            ibanLast4: input.iban.slice(-4),
          };
          owner.version = input.expectedVersion + 1;
          return ok({ owner });
        },
        inviteOwner: () => {
          if (!owner) return fail("NOT_FOUND", 404);
          const input = c.invitationInputSchema.parse(raw);
          if (owner.linked) return fail("OWNER_ALREADY_LINKED");
          if (owner.invitation?.status === "pending")
            return fail("INVITATION_PENDING", 409);
          if (!input.email && !owner.email)
            return fail("OWNER_EMAIL_REQUIRED", 422, "email");
          owner.invitation = {
            id: id(),
            status: "pending",
            expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
          };
          owner.onboarding.status = "invited";
          return ok({ invitation: owner.invitation });
        },
        listProperties: () => {
          const input = c.propertyQuerySchema.parse(raw);
          const q = input.q?.toLowerCase();
          return ok(
            page(
              properties.filter(
                (p) =>
                  !q || `${p.name.en} ${p.name.ar}`.toLowerCase().includes(q),
              ),
              input,
            ),
          );
        },
        createProperty: () => {
          const input = c.createPropertySchema.parse(raw);
          const linked = owners.find((o) => o.id === input.ownerId);
          if (!linked) return fail("OWNER_NOT_FOUND", 422, "ownerId");
          if (
            input.prpNumber &&
            properties.some((p) => p.prpNumber === input.prpNumber)
          )
            return fail("PRP_NUMBER_TAKEN", 422, "prpNumber");
          const next: c.PropertyDetail = {
            id: id(),
            version: 1,
            name: input.name,
            kind: input.kind,
            area: input.area ?? null,
            use: input.use,
            owners: [{ id: linked.id, fullName: linked.fullName }],
            unitCount: 0,
            unitsByStatus: counts(),
            titleDeed: null,
            ownerGate: {
              value: linked.ownerGate.value,
              source: linked.ownerGate.source,
            },
            plotNo: input.plotNo ?? null,
            titleDeedNo: input.titleDeedNo ?? null,
            prpNumber: input.prpNumber ?? null,
            onwaniAddress: input.onwaniAddress ?? null,
            zone: input.zone ?? null,
            ownerGateOverride: input.ownerGateOverride,
            documents: [],
            units: [],
            history: [],
          };
          properties.push(next);
          return ok({ property: next });
        },
        getProperty: () => {
          if (!property) return fail("NOT_FOUND", 404);
          if (
            !context.staffRoles.includes("manager") &&
            !property.owners.some((owner) =>
              context.partyLinks.some(
                (link) => link.role === "owner" && link.partyId === owner.id,
              ),
            )
          )
            return fail("NOT_FOUND", 404);
          return ok(
            context.staffRoles.includes("manager")
              ? property
              : { ...property, history: [] },
          );
        },
        updateProperty: () => {
          if (!property) return fail("NOT_FOUND", 404);
          const { expectedVersion, reason, ...fields } =
            c.updatePropertySchema.parse(raw);
          if (
            fields.ownerGateOverride !== undefined &&
            fields.ownerGateOverride !== property.ownerGateOverride &&
            !reason
          )
            return fail("REASON_REQUIRED", 422, "reason");
          if (
            fields.prpNumber &&
            properties.some(
              (p) => p.id !== property.id && p.prpNumber === fields.prpNumber,
            )
          )
            return fail("PRP_NUMBER_TAKEN", 422, "prpNumber");
          Object.assign(property, fields);
          property.version = expectedVersion + 1;
          recordPropertyChange(property, "property.updated", reason ?? null);
          return ok({ property });
        },
        createUnits: () => {
          if (!property) return fail("NOT_FOUND", 404);
          const input = c.createUnitsSchema.parse(raw);
          const seenNo = new Set(property.units.map((u) => u.unitNo));
          const seenUnt = new Set(
            properties
              .flatMap((p) => p.units.map((u) => u.untNumber))
              .filter(Boolean),
          );
          for (const [i, unit] of input.units.entries()) {
            if (seenNo.has(unit.unitNo))
              return fail(
                "UNIT_NUMBER_TAKEN",
                422,
                `units[${String(i)}].unitNo`,
              );
            if (unit.untNumber && seenUnt.has(unit.untNumber))
              return fail(
                "UNT_NUMBER_TAKEN",
                422,
                `units[${String(i)}].untNumber`,
              );
            seenNo.add(unit.unitNo);
            if (unit.untNumber) seenUnt.add(unit.untNumber);
          }
          const units: c.UnitItem[] = input.units.map((u) => ({
            ...u,
            id: id(),
            version: 1,
            untNumber: u.untNumber ?? null,
            bedrooms: u.bedrooms ?? null,
            areaSqm: u.areaSqm ?? null,
            status: "vacant",
            blockReason: null,
          }));
          property.units.push(...units);
          return ok({ units });
        },
        updateUnit: () => {
          const unit = property?.units.find((u) => u.id === ids[1]);
          if (!unit) return fail("NOT_FOUND", 404);
          const { expectedVersion, ...fields } = c.updateUnitSchema.parse(raw);
          if (
            fields.unitNo &&
            property?.units.some(
              (u) => u.id !== unit.id && u.unitNo === fields.unitNo,
            )
          )
            return fail("UNIT_NUMBER_TAKEN", 422, "unitNo");
          if (
            fields.untNumber &&
            properties.some((p) =>
              p.units.some(
                (u) => u.id !== unit.id && u.untNumber === fields.untNumber,
              ),
            )
          )
            return fail("UNT_NUMBER_TAKEN", 422, "untNumber");
          Object.assign(unit, fields);
          unit.version = expectedVersion + 1;
          if (property) recordPropertyChange(property, "unit.updated", null);
          return ok({ unit });
        },
        changeUnitStatus: () => {
          const unit = property?.units.find((u) => u.id === ids[1]);
          if (!unit) return fail("NOT_FOUND", 404);
          const input = c.unitStatusInputSchema.parse(raw);
          const transition = unitTransitions.find(
            (row) => row.from === unit.status && row.command === input.command,
          );
          if (!transition) return fail("INVALID_TRANSITION", 409);
          const to = transition.to;
          if (input.command === "block" && !input.blockReason)
            return fail("VALIDATION_FAILED", 422, "blockReason");
          unit.status = to;
          unit.blockReason =
            to === "blocked" ? (input.blockReason ?? null) : null;
          unit.version = input.expectedVersion + 1;
          if (property)
            recordPropertyChange(property, "unit.status_changed", input.reason);
          return ok({ unit });
        },
        requestOwnerUpload: documentCommand,
        checkOwnerDocument: documentCommand,
        acceptOwnerDocument: documentCommand,
        rejectOwnerDocument: documentCommand,
        requestPropertyUpload: documentCommand,
        checkPropertyDocument: documentCommand,
        acceptPropertyDocument: documentCommand,
        rejectPropertyDocument: documentCommand,
      };
    return handlers[name]();
  }
  return bindApi(execute);
}

function validationFailure(error: z.ZodError): Result<never, c.EstateProblem> {
  const issue = error.issues[0];
  const field = issue?.path.reduce<string>(
    (result, part) =>
      typeof part === "number"
        ? `${result}[${String(part)}]`
        : result
          ? `${result}.${String(part)}`
          : String(part),
    "",
  );
  const code =
    field === "byteSize"
      ? "UPLOAD_TOO_LARGE"
      : field === "contentType"
        ? "UNSUPPORTED_TYPE"
        : field === "docType"
          ? "DOC_TYPE_NOT_ALLOWED"
          : "VALIDATION_FAILED";
  return fail(code, 422, field);
}

function requestUpload(
  record: c.OwnerDetail | c.PropertyDetail,
  raw: unknown,
  company: string,
): Result<unknown, c.EstateProblem> {
  const input = c.uploadInputSchema.parse(raw);
  let doc = record.documents.find((d) => d.docType === input.docType);
  if (!doc) {
    doc = {
      documentId: id(),
      docType: input.docType,
      current: null,
      latest: null,
    };
    record.documents.push(doc);
  }
  const version: c.VersionItem = {
    versionId: id(),
    version: 1,
    versionNo: (doc.latest?.versionNo ?? 0) + 1,
    processingStatus: "awaiting_upload",
    reviewStatus: "pending_review",
    issueDate: null,
    expiryDate: null,
    validity: null,
    rejectReason: null,
    scanResult: null,
  };
  doc.latest = version;
  return ok({
    documentId: doc.documentId,
    documentVersionId: version.versionId,
    versionNo: version.versionNo,
    upload: {
      url: `/en/companies/${company}/properties/mock-upload`,
      method: "PUT",
      headers: {
        "Content-Type": input.contentType,
        "x-amz-checksum-sha256": Buffer.from(input.sha256, "hex").toString(
          "base64",
        ),
      },
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    },
  });
}

function acceptVersion(
  doc: c.DocumentItem,
  version: c.VersionItem,
  raw: unknown,
): Result<unknown, c.EstateProblem> {
  const input = c.acceptInputSchema.parse(raw);
  if (version.processingStatus !== "scan_clean")
    return fail("SCAN_NOT_CLEAN", 409);
  if (c.ownerDocTypeSchema.safeParse(doc.docType).success && !input.expiryDate)
    return fail("EXPIRY_REQUIRED", 422, "expiryDate");
  if (input.expiryDate && input.issueDate && input.expiryDate < input.issueDate)
    return fail("EXPIRY_BEFORE_ISSUE", 422, "expiryDate");
  version.issueDate = input.issueDate ?? null;
  version.expiryDate = input.expiryDate ?? null;
  version.validity = input.expiryDate
    ? input.expiryDate < new Date().toISOString().slice(0, 10)
      ? "expired"
      : "valid"
    : null;
  version.reviewStatus = "accepted";
  if (doc.current && doc.current.versionId !== version.versionId)
    doc.current.reviewStatus = "superseded";
  doc.current = version;

  return ok({ version });
}

function mayRead(
  context: CompanyContext,
  name: RouteName,
  ownerId?: string,
): boolean {
  return (
    context.staffRoles.includes("manager") ||
    (name === "getProperty" &&
      context.partyLinks.some((p) => p.role === "owner")) ||
    (name === "getOwner" &&
      context.partyLinks.some(
        (p) => p.role === "owner" && p.partyId === ownerId,
      ))
  );
}
function versionConflict(
  name: RouteName,
  data: {
    owner: c.OwnerDetail | undefined;
    property: c.PropertyDetail | undefined;
    ids: string[];
    expected: z.ZodSafeParseResult<{ expectedVersion: number | null }>;
  },
): boolean {
  const { owner, property, ids, expected } = data;
  const tracked =
    name === "putMandate"
      ? owner?.mandate
      : name === "updateUnit" || name === "changeUnitStatus"
        ? property?.units.find((u) => u.id === ids[1])
        : (owner ?? property);
  return (
    expected.success &&
    !name.includes("Document") &&
    expected.data.expectedVersion !== (tracked?.version ?? null)
  );
}

function recordPropertyChange(
  property: c.PropertyDetail,
  eventType: string,
  reason: string | null,
): void {
  property.history.unshift({
    eventType,
    reason,
    occurredAt: new Date().toISOString(),
    actorDisplayName: "Synthetic manager",
    actorRole: "manager",
    channel: "web_form",
  });
}
