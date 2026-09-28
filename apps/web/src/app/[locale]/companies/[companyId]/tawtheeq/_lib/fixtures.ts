import { MOCK_ACCOUNTS, MOCK_PARTY_IDS } from "@/lib/api/mock-fixtures";
import type { Comparison, TawtheeqRecord } from "./schemas";
export const mockRecordIds = {
  awaiting: "65000000-0000-4000-8000-000000000001",
  differences: "65000000-0000-4000-8000-000000000003",
  identity: "65000000-0000-4000-8000-000000000004",
  registered: "65000000-0000-4000-8000-000000000005",
  skipped: "65000000-0000-4000-8000-000000000006",
} as const;
export function contractValues(
  record: TawtheeqRecord,
): Record<string, string | number | null> {
  const c = record.contract;
  return {
    unt_number: c.unit.untNumber,
    owner_id_number: c.owner.idNumberMasked,
    tenant_id_number: c.tenant.idNumberMasked,
    term_start: c.termStart,
    term_end: c.termEnd,
    annual_rent_fils: c.annualRentFils,
    deposit_fils: c.depositFils,
    contract_type: "RESIDENTIAL",
    owner_name: c.owner.nameEn,
    tenant_name: c.tenant.nameEn,
  };
}
export function syntheticRecord(
  id: string,
  contractNo: string,
): TawtheeqRecord {
  const owner = MOCK_ACCOUNTS.find((a) => a.handle === "owner-1");
  const tenant = MOCK_ACCOUNTS.find((a) => a.handle === "tenant-1");
  if (!owner || !tenant) throw new Error("Missing synthetic parties");
  return {
    id,
    version: 1,
    contractId: id.replace("65000000", "66000000"),
    path: "normal",
    workflowState: "awaiting_registration",
    portalStatus: "not_started",
    tawtheeqNumber: null,
    registeredOn: null,
    skipReason: null,
    returnReason: null,
    attestedOn: null,
    daysPending: 6,
    contract: {
      contractNo,
      status: "concluded",
      currentVersionId: id.replace("65000000", "67000000"),
      versionNo: 1,
      contentHash: "a".repeat(64),
      frozenOwnerGate: true,
      termStart: "2026-10-01",
      termEnd: "2027-09-30",
      annualRentFils: 7_000_000,
      depositFils: 350_000,
      totalFils: 7_000_000,
      graceDays: 15,
      unit: {
        id: id.replace("65000000", "68000000"),
        unitNo: "107",
        untNumber: "UNT-SYNTHETIC-107",
      },
      owner: {
        partyId: MOCK_PARTY_IDS["owner-1"],
        nameEn: `${owner.name.en} (synthetic)`,
        nameAr: `${owner.name.ar} (اصطناعي)`,
        idNumberMasked: "784-0000-0000001-1",
      },
      tenant: {
        partyId: MOCK_PARTY_IDS["tenant-1"],
        nameEn: `${tenant.name.en} (synthetic)`,
        nameAr: `${tenant.name.ar} (اصطناعي)`,
        idNumberMasked: "784-0000-0000002-2",
      },
    },
    document: null,
    extraction: null,
    comparison: [],
    discrepancies: [],
    adoption: null,
    allowedActions: ["attest_portal", "skip", "upload"],
  };
}
export function seedRecords(): TawtheeqRecord[] {
  const awaiting = syntheticRecord(mockRecordIds.awaiting, "C-TW-01");
  awaiting.contract.frozenOwnerGate = false;
  const differences = syntheticRecord(mockRecordIds.differences, "C-TW-03");
  const identity = syntheticRecord(mockRecordIds.identity, "C-TW-04");
  const registered = syntheticRecord(mockRecordIds.registered, "C-TW-05");
  const skipped = syntheticRecord(mockRecordIds.skipped, "C-TW-06");
  for (const r of [differences, identity, registered]) {
    r.document = {
      documentVersionId: r.id.replace("65000000", "69000000"),
      versionNo: 1,
      contentType: "image/svg+xml",
      byteSize: 2048,
      processingStatus: "scan_clean",
      reviewStatus: "accepted",
      rejectReason: null,
      createdAt: "2026-09-22T08:00:00Z",
    };
    r.tawtheeqNumber = `SYNTHETIC-${r.contract.contractNo}`;
    r.registeredOn = "2026-09-22";
    r.comparison = Object.entries(contractValues(r)).map(([field, value]) => ({
      field,
      class:
        field.includes("id_number") || field === "unt_number"
          ? "identity"
          : field.endsWith("_name")
            ? "minor"
            : "material",
      contractValue: value,
      registeredValue: value,
      status: "match",
    })) as Comparison[];
  }
  differences.workflowState = "discrepancies_open";
  differences.portalStatus = "pending";
  differences.allowedActions = [
    "reregister",
    "prepare_adoption",
    "register_resolved",
  ];
  for (const row of differences.comparison) {
    if (row.field === "annual_rent_fils") {
      row.registeredValue = 7_200_000;
      row.status = "mismatch";
    }
    if (row.field === "tenant_name") {
      row.registeredValue = String(row.contractValue).toUpperCase();
      row.status = "format_only";
    }
  }
  differences.discrepancies = differences.comparison
    .filter((c) => c.status !== "match")
    .map((c, i) => ({
      ...c,
      id: `70000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      status: "open",
      resolution: null,
    }));
  const identityRow = identity.comparison.find(
    (c) => c.field === "tenant_id_number",
  );
  if (identityRow) {
    identityRow.registeredValue = "784-0000-0000099-9";
    identityRow.status = "mismatch";
  }
  if (identity.document) {
    identity.document.reviewStatus = "rejected";
    identity.document.rejectReason = "Identity mismatch: tenant_id_number";
  }
  registered.workflowState = "registered";
  registered.portalStatus = "registered";
  registered.daysPending = null;
  registered.allowedActions = ["upload", "close"];
  skipped.workflowState = "skipped";
  skipped.path = "skip";
  skipped.daysPending = null;
  skipped.allowedActions = ["resume"];
  return [awaiting, differences, identity, registered, skipped];
}
