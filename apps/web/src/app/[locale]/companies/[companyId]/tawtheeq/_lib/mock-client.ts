import "server-only";
import { createHash, randomUUID } from "node:crypto";
import {
  portalStatusOf,
  resolveDiscrepancy,
  tawtheeqTransitions,
} from "@aqarak/domain";
import type { CompanyContext } from "@/lib/api/contract";
import { recordAuditChange } from "../../audit/_lib/mock-store";
import { MOCK_COMPANY_A_ID } from "@/lib/api/mock-fixtures";
import type { TawtheeqClient } from "./client";
import { contractValues } from "./fixtures";
import {
  mockObjectUrl,
  mockStore,
  reserveObject,
  pendingOwnerRecord,
  publishOwnerRecord,
  type MockObject,
} from "./mock-store";
import {
  recordSchema,
  type Comparison,
  type Extraction,
  type ResolutionsInput,
  type ReviewInput,
  type TawtheeqRecord,
  type WorkflowResult,
} from "./schemas";
function failure(code: string, status = 422): WorkflowResult<never> {
  return {
    ok: false,
    error: {
      status,
      code:
        status === 403
          ? "NOT_PERMITTED"
          : status === 409 && code === "SCAN_PENDING"
            ? "INVALID_TRANSITION"
            : "VALIDATION_FAILED",
      domainCode: code,
    },
  };
}
function success<T>(value: T): WorkflowResult<T> {
  return { ok: true, value: structuredClone(value) };
}
function update(
  record: TawtheeqRecord,
  state: TawtheeqRecord["workflowState"],
): void {
  record.workflowState = state;
  record.version += 1;
  record.portalStatus = portalStatusOf(state, { isRenewal: false });
  record.daysPending = ["registered", "skipped", "closed"].includes(state)
    ? null
    : 6;
  record.allowedActions = tawtheeqTransitions
    .filter((t) => t.from === state && t.actor === "manager")
    .map((t) => t.command);
}
function may(record: TawtheeqRecord, command: string): boolean {
  return record.allowedActions.includes(command);
}
function normal(
  field: string,
  value: string | number | null,
): string | number | null {
  if (value === null) return null;
  if (field.endsWith("_fils"))
    return typeof value === "number" ? value : decimalFils(value);
  if (field.includes("id_number") || field === "unt_number")
    return String(value).replace(/\D/g, "");
  return String(value)
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
function review(
  record: TawtheeqRecord,
  input: ReviewInput,
): WorkflowResult<TawtheeqRecord> {
  if (record.workflowState !== "under_review")
    return failure("INVALID_TRANSITION");
  if (record.document?.documentVersionId !== input.documentVersionId)
    return failure("REGISTRATION_EVIDENCE_MISSING");
  if (record.document.processingStatus === "scan_rejected")
    return failure("SCAN_REJECTED");
  if (record.document.processingStatus !== "scan_clean")
    return failure("SCAN_PENDING");
  if (input.extractionId !== (record.extraction?.extractionId ?? null))
    return failure("INVALID_INPUT");
  const provenanceError = checkProvenance(record, input);
  if (provenanceError) return provenanceError;
  record.comparison = compareReview(record, input);
  record.tawtheeqNumber = input.fields.tawtheeq_number.value;
  record.registeredOn = input.fields.registered_on.value;
  const identity = record.comparison.find(
    (c) => c.class === "identity" && c.status !== "match",
  );
  record.document.reviewStatus = identity ? "rejected" : "accepted";
  record.document.rejectReason = identity
    ? `Identity mismatch: ${identity.field}`
    : null;
  record.discrepancies = identity
    ? []
    : record.comparison
        .filter(
          (c) =>
            c.class !== "identity" &&
            c.status !== "match" &&
            c.registeredValue !== null,
        )
        .map((c) => ({
          ...c,
          id: randomUUID(),
          status: "open",
          resolution: null,
        }));
  update(
    record,
    identity
      ? "awaiting_registration"
      : record.discrepancies.length
        ? "discrepancies_open"
        : "registered",
  );
  return success(recordSchema.parse(record));
}
function resolve(
  record: TawtheeqRecord,
  input: ResolutionsInput,
): WorkflowResult<TawtheeqRecord> {
  if (record.workflowState !== "discrepancies_open")
    return failure("INVALID_TRANSITION");
  const open = record.discrepancies.filter((d) => d.status === "open");
  if (
    open.length !== input.choices.length ||
    new Set(input.choices.map((c) => c.discrepancyId)).size !== open.length
  )
    return failure("DISCREPANCIES_UNRESOLVED");
  const choiceError = checkChoices(open, input);
  if (choiceError) return choiceError;
  for (const choice of input.choices) {
    const d = open.find((item) => item.id === choice.discrepancyId);
    if (d) {
      d.status = "resolved";
      d.resolution = {
        kind: choice.kind,
        reason: choice.reason,
        basis: choice.basis ?? null,
      };
    }
  }
  if (input.choices.some((c) => c.kind === "cancel_and_reregister")) {
    record.comparison = [];
    record.extraction = null;
    record.document = null;
    record.adoption = null;
    update(record, "awaiting_registration");
    return success(record);
  }
  return adoptResolved(record, open);
}

function applyAdoption(
  record: TawtheeqRecord,
  field: string,
  value: string | number | null,
): void {
  if (field === "annual_rent_fils") {
    record.contract.annualRentFils = Number(value);
    record.contract.totalFils = Number(value);
  }
  if (field === "deposit_fils") record.contract.depositFils = Number(value);
  if (field === "term_start") record.contract.termStart = String(value);
  if (field === "term_end") record.contract.termEnd = String(value);
  if (field === "owner_name") record.contract.owner.nameEn = String(value);
  if (field === "tenant_name") record.contract.tenant.nameEn = String(value);
}
export function createMockClient(
  companyId: string,
  sessionId: string,
  context?: CompanyContext,
): TawtheeqClient {
  function read(id: string): WorkflowResult<TawtheeqRecord> {
    if (companyId !== MOCK_COMPANY_A_ID) return failure("NOT_PERMITTED", 403);
    const shared = pendingOwnerRecord(id);
    const owner = context?.partyLinks.some(
      (link) =>
        link.role === "owner" &&
        link.partyId === shared?.record.contract.owner.partyId,
    );
    const record =
      owner && shared ? shared.record : mockStore(sessionId).records.get(id);
    return record
      ? success(recordSchema.parse(record))
      : failure("NOT_FOUND", 404);
  }
  function command<T>(
    id: string,
    operation: { name: string; body: unknown; key: string },
    execute: (record: TawtheeqRecord) => WorkflowResult<T>,
  ): WorkflowResult<T> {
    const { name, body, key } = operation;
    const result = read(id);
    if (!result.ok) return result;
    const replayKey = `${sessionId}:${companyId}:${id}:${name}:${key}`;
    const fingerprint = JSON.stringify(body);
    const replay = mockStore(sessionId).replays.get(replayKey);
    if (replay)
      return replay.fingerprint === fingerprint
        ? (structuredClone(replay.result) as WorkflowResult<T>)
        : failure("IDEMPOTENCY_CONFLICT", 409);
    if (
      typeof body === "object" &&
      body !== null &&
      "expectedVersion" in body &&
      body.expectedVersion !== result.value.version
    )
      return failure("STALE_VERSION", 409);
    const record = result.value;
    const before = structuredClone(record);
    const response = execute(record);
    if (response.ok) mockStore(sessionId).records.set(id, record);
    if (response.ok) persistRecordChange({ sessionId, before, record, name });
    mockStore(sessionId).replays.set(replayKey, {
      fingerprint,
      result: structuredClone(response),
    });
    return response;
  }
  const client = {
    ownerReapproval: (id, input, key) =>
      command(
        id,
        {
          name:
            input.decision === "approve"
              ? "owner_reapproved"
              : "owner_returned",
          body: input,
          key,
        },
        (r) => {
          if (
            !context?.partyLinks.some(
              (link) =>
                link.role === "owner" &&
                link.partyId === r.contract.owner.partyId,
            )
          )
            return failure("NOT_NAMED_PARTY", 403);
          if (r.workflowState !== "awaiting_owner_reapproval" || !r.adoption)
            return failure("INVALID_TRANSITION");
          if (input.decision === "return" && !input.reason?.trim())
            return failure("REASON_REQUIRED");
          if (input.decision === "approve") {
            r.contract.currentVersionId = r.adoption.contractVersionId;
            r.contract.versionNo = r.adoption.versionNo;
            r.contract.contentHash = r.adoption.contentHash;
            for (const [field, value] of Object.entries(
              r.adoption.changedFields,
            ))
              applyAdoption(r, field, value);
            r.adoption.ownerApproval = { status: "approved", reason: null };
            update(r, "registered");
          } else {
            r.adoption.ownerApproval = {
              status: "returned",
              reason: input.reason ?? null,
            };
            r.returnReason = input.reason ?? null;
            update(r, "awaiting_registration");
          }
          return success(r);
        },
      ),
    skipConfirmation: (id, input, key) =>
      command(id, { name: "skip_confirmation", body: input, key }, (r) => {
        if (
          !context?.partyLinks.some(
            (link) =>
              link.role === "owner" &&
              link.partyId === r.contract.owner.partyId,
          )
        )
          return failure("NOT_NAMED_PARTY", 403);
        const pending = pendingOwnerRecord(id);
        if (
          !pending ||
          !r.skipReason ||
          r.workflowState !== "awaiting_registration"
        )
          return failure("INVALID_TRANSITION");
        if (input.decision === "return" && !input.reason?.trim())
          return failure("REASON_REQUIRED");
        pending.skipApproved = input.decision === "approve";
        r.returnReason =
          input.decision === "return" ? (input.reason ?? null) : null;
        r.version += 1;
        return success(r);
      }),
    listRecords: () =>
      companyId !== MOCK_COMPANY_A_ID
        ? failure("NOT_PERMITTED", 403)
        : success({
            records: [...mockStore(sessionId).records.values()].map((r) => ({
              id: r.id,
              contractId: r.contractId,
              contractNo: r.contract.contractNo,
              unitLabel: r.contract.unit.unitNo,
              tenantName: r.contract.tenant.nameEn,
              workflowState: r.workflowState,
              portalStatus: r.portalStatus,
              path: r.path,
              daysPending: r.daysPending,
              openDiscrepancies: r.discrepancies.filter(
                (d) => d.status === "open",
              ).length,
              updatedAt: "2026-09-28T06:00:00Z",
            })),
          }),
    getRecord: (id: string) => read(id),
    getDocumentUrl: (id: string) => {
      const result = read(id);
      if (!result.ok) return result;
      const document = result.value.document;
      if (!document) return failure("NOT_FOUND", 404);
      if (document.processingStatus === "scan_rejected")
        return failure("SCAN_REJECTED");
      if (document.processingStatus !== "scan_clean")
        return failure("SCAN_PENDING");
      const object = mockStore(sessionId).objects.get(
        document.documentVersionId,
      );
      if (object) object.expires = Date.now() + 300_000;
      const url = object
        ? mockObjectUrl(companyId, object)
        : `/en/companies/${companyId}/tawtheeq/mock-storage/${document.documentVersionId}?record=${id}`;
      return success({
        url,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        contentType: document.contentType,
      });
    },
    attestPortal: (id, input, key) =>
      command(id, { name: "attest", body: input, key }, (r) => {
        if (!may(r, "attest_portal")) return failure("INVALID_TRANSITION");
        r.attestedOn = new Date().toISOString().slice(0, 10);
        update(r, "submitted_on_portal");
        return success(r);
      }),
    requestUpload: (id, input, key) =>
      command(id, { name: "upload", body: input, key }, (r) => {
        if (!may(r, "upload")) return failure("INVALID_TRANSITION");
        const object = reserveObject(id, sessionId, input);
        return success({
          documentVersionId: object.id,
          upload: {
            url: mockObjectUrl(companyId, object),
            method: "PUT" as const,
            headers: {
              "Content-Type": input.contentType,
              "x-amz-checksum-sha256": Buffer.from(
                input.sha256,
                "hex",
              ).toString("base64"),
            },
            expiresAt: new Date(object.expires).toISOString(),
          },
        });
      }),
    completeUpload: (id, documentId, input, key) =>
      command(
        id,
        { name: "complete", body: { ...input, documentId }, key },
        (r) => {
          const object = mockStore(sessionId).objects.get(documentId);
          if (object?.recordId !== id || object.sessionId !== sessionId)
            return failure("REGISTRATION_EVIDENCE_MISSING");
          if (!object.bytes) return failure("UPLOAD_NOT_FOUND");
          const completed = completedDocument(r, documentId);
          if (completed) return completed;
          if (!may(r, "upload") && r.document?.documentVersionId !== documentId)
            return failure("INVALID_TRANSITION");
          const scanError = completeScan(object);
          if (scanError) return scanError;
          r.document = {
            documentVersionId: documentId,
            versionNo: (r.document?.versionNo ?? 0) + 1,
            contentType: object.input.contentType,
            byteSize: object.input.byteSize,
            processingStatus: "scan_clean",
            reviewStatus: "pending_review",
            rejectReason: null,
            createdAt: new Date().toISOString(),
          };
          r.extraction = null;
          r.comparison = [];
          r.discrepancies = [];
          r.adoption = null;
          update(r, "under_review");
          return success(r);
        },
      ),
    runExtraction: (id, key) =>
      command(id, { name: "extraction", body: {}, key }, (r) => {
        if (r.document?.processingStatus === "scan_rejected")
          return failure("SCAN_REJECTED");
        if (r.document?.processingStatus !== "scan_clean")
          return failure("SCAN_PENDING");
        if (r.document.contentType === "application/pdf")
          return success<Extraction>({
            status: "degraded",
            degradedMode: "manual_entry",
            extractionId: null,
            registryEntry: "synthetic.manual",
            confidenceLabel: "uncalibrated",
            fields: {},
            comparisonPreview: [],
          });
        const values: Record<string, string | number | null> = {
          ...contractValues(r),
          tawtheeq_number: `SYNTHETIC-${r.contract.contractNo}`,
          registered_on: "2026-09-28",
        };
        const fields = Object.fromEntries(
          Object.entries(values).map(([field, value]) => {
            const text = field.endsWith("_fils")
              ? (Number(value) / 100).toFixed(2)
              : String(value);
            return [field, { value: text, evidence: text, nullReason: null }];
          }),
        );
        r.extraction = {
          extractionId: randomUUID(),
          status: "succeeded",
          registryEntry: "synthetic.fixture",
          confidenceLabel: "uncalibrated",
          fields,
        };
        return success<Extraction>({
          ...r.extraction,
          status: "succeeded",
          degradedMode: null,
          comparisonPreview: [],
        });
      }),
    submitReview: (id, input, key) =>
      command(id, { name: "review", body: input, key }, (r) =>
        review(r, input),
      ),
    submitResolutions: (id, input, key) =>
      command(id, { name: "resolutions", body: input, key }, (r) =>
        resolve(r, input),
      ),
    portalReturn: (id, input, key) =>
      command(id, { name: "return", body: input, key }, (r) => {
        if (!may(r, "portal_return")) return failure("INVALID_TRANSITION");
        if (!input.reason.trim()) return failure("REASON_REQUIRED");
        r.returnReason = input.reason;
        update(r, "awaiting_registration");
        return success(r);
      }),
    skip: (id, input, key) =>
      command(id, { name: "skip", body: input, key }, (r) => {
        if (!may(r, "skip")) return failure("INVALID_TRANSITION");
        if (!input.reason.trim()) return failure("REASON_REQUIRED");
        const confirmed =
          pendingOwnerRecord(id)?.sessionId === sessionId &&
          pendingOwnerRecord(id)?.skipApproved;
        if (
          r.contract.frozenOwnerGate &&
          !confirmed &&
          !input.requestOwnerConfirmation
        )
          return failure("OWNER_CONFIRMATION_REQUIRED");
        if (r.contract.frozenOwnerGate && !confirmed && r.skipReason)
          return failure("INVALID_TRANSITION");
        r.skipReason = input.reason;
        if (r.contract.frozenOwnerGate && !confirmed) r.version += 1;
        else {
          r.path = "skip";
          update(r, "skipped");
        }
        return success(r);
      }),
    resume: (id, input, key) =>
      command(id, { name: "resume", body: input, key }, (r) => {
        if (!may(r, "resume")) return failure("INVALID_TRANSITION");
        r.path = "normal";
        r.skipReason = null;
        update(r, "awaiting_registration");
        return success(r);
      }),
  } satisfies SyncClient;
  return asyncClient(client);
}

function checkProvenance(
  record: TawtheeqRecord,
  input: ReviewInput,
): WorkflowResult<never> | null {
  for (const [key, field] of Object.entries(input.fields)) {
    if (!field) continue;
    const proposal = record.extraction?.fields[key]?.value;
    const expected =
      proposal == null
        ? "manual"
        : (
              key.endsWith("_fils")
                ? normal(key, proposal) === normal(key, field.value)
                : proposal === field.value
            )
          ? "extracted"
          : "edited";
    if (field.provenance !== expected) return failure("INVALID_INPUT");
  }
  return null;
}

function compareReview(
  record: TawtheeqRecord,
  input: ReviewInput,
): Comparison[] {
  const basis = contractValues(record);
  return Object.entries(basis).map(([field, contractValue]) => {
    const value =
      input.fields[field as keyof ReviewInput["fields"]]?.value ?? null;
    const registeredValue = field.endsWith("_fils")
      ? normal(field, value)
      : value;
    const status =
      registeredValue === null
        ? "missing_registered"
        : normal(field, contractValue) !== normal(field, registeredValue)
          ? "mismatch"
          : field.endsWith("_name") && contractValue !== registeredValue
            ? "format_only"
            : "match";
    return {
      field,
      class:
        field.includes("id_number") || field === "unt_number"
          ? "identity"
          : field.endsWith("_name")
            ? "minor"
            : "material",
      contractValue,
      registeredValue,
      status,
    } as Comparison;
  });
}

function checkChoices(
  open: TawtheeqRecord["discrepancies"],
  input: ResolutionsInput,
): WorkflowResult<never> | null {
  for (const choice of input.choices) {
    const d = open.find((item) => item.id === choice.discrepancyId);
    if (!d || d.field === "tawtheeq_number" || d.field === "registered_on")
      return failure("DISCREPANCIES_UNRESOLVED");
    if (
      choice.kind === "mark_equivalent" &&
      (d.class !== "minor" || !choice.basis)
    )
      return failure("MARK_EQUIVALENT_NOT_ALLOWED");
    const checked = resolveDiscrepancy(
      {
        field: d.field,
        priorValue: d.contractValue ?? "",
        registeredValue: d.registeredValue ?? "",
      },
      choice.kind === "mark_equivalent"
        ? {
            ...choice,
            kind: "mark_equivalent",
            basis: choice.basis ?? "formatting",
          }
        : { kind: choice.kind, reason: choice.reason },
    );
    if (!checked.ok) return failure(checked.error.code);
  }
  return null;
}

function adoptResolved(
  record: TawtheeqRecord,
  open: TawtheeqRecord["discrepancies"],
): WorkflowResult<TawtheeqRecord> {
  const adopted = open.filter((d) => d.resolution?.kind === "adopt");
  const gate =
    record.contract.frozenOwnerGate &&
    adopted.some((d) => d.class === "material");
  if (adopted.length) {
    record.adoption = {
      contractVersionId: randomUUID(),
      versionNo: record.contract.versionNo + 1,
      contentHash: randomUUID().replaceAll("-", "").repeat(2),
      changedFields: Object.fromEntries(
        adopted.map((d) => [d.field, d.registeredValue ?? ""]),
      ),
      ownerApproval: gate ? { status: "requested", reason: null } : null,
    };
    if (!gate) {
      record.contract.currentVersionId = record.adoption.contractVersionId;
      record.contract.versionNo = record.adoption.versionNo;
      record.contract.contentHash = record.adoption.contentHash;
      for (const d of adopted)
        applyAdoption(record, d.field, d.registeredValue);
    }
  }
  update(record, gate ? "awaiting_owner_reapproval" : "registered");
  return success(recordSchema.parse(record));
}
type SyncClient = {
  [K in keyof TawtheeqClient]: (
    ...args: Parameters<TawtheeqClient[K]>
  ) => Awaited<ReturnType<TawtheeqClient[K]>>;
};
function asyncClient(client: SyncClient): TawtheeqClient {
  return {
    ownerReapproval: (...args) =>
      Promise.resolve(client.ownerReapproval(...args)),
    skipConfirmation: (...args) =>
      Promise.resolve(client.skipConfirmation(...args)),
    listRecords: () => Promise.resolve(client.listRecords()),
    getRecord: (...args) => Promise.resolve(client.getRecord(...args)),
    getDocumentUrl: (...args) =>
      Promise.resolve(client.getDocumentUrl(...args)),
    attestPortal: (...args) => Promise.resolve(client.attestPortal(...args)),
    requestUpload: (...args) => Promise.resolve(client.requestUpload(...args)),
    completeUpload: (...args) =>
      Promise.resolve(client.completeUpload(...args)),
    runExtraction: (...args) => Promise.resolve(client.runExtraction(...args)),
    submitReview: (...args) => Promise.resolve(client.submitReview(...args)),
    submitResolutions: (...args) =>
      Promise.resolve(client.submitResolutions(...args)),
    portalReturn: (...args) => Promise.resolve(client.portalReturn(...args)),
    skip: (...args) => Promise.resolve(client.skip(...args)),
    resume: (...args) => Promise.resolve(client.resume(...args)),
  };
}

function completeScan(object: MockObject): WorkflowResult<never> | null {
  if (!object.bytes) return failure("UPLOAD_NOT_FOUND");
  if (
    createHash("sha256").update(object.bytes).digest("hex") !==
      object.input.sha256 ||
    object.bytes.length !== object.input.byteSize
  )
    return failure("CHECKSUM_MISMATCH");
  if (object.rejected) return failure("SCAN_REJECTED");
  object.completionAttempts += 1;
  if (
    object.input.fileName.toLowerCase().includes("pending") &&
    object.completionAttempts === 1
  )
    return failure("SCAN_PENDING", 409);
  return null;
}

function completedDocument(
  record: TawtheeqRecord,
  documentId: string,
): WorkflowResult<TawtheeqRecord> | null {
  const document = record.document;
  if (
    document?.documentVersionId !== documentId ||
    document.processingStatus === "uploaded"
  )
    return null;
  return document.processingStatus === "scan_rejected"
    ? failure("SCAN_REJECTED")
    : success(record);
}

function decimalFils(value: string): number {
  const parts = /^(\d+)\.(\d{2})$/.exec(value.trim());
  if (!parts?.[1] || !parts[2]) throw new Error("Invalid decimal amount");
  return Number(BigInt(parts[1]) * 100n + BigInt(parts[2]));
}

function persistRecordChange({
  sessionId,
  before,
  record,
  name,
}: {
  sessionId: string;
  before: TawtheeqRecord;
  record: TawtheeqRecord;
  name: string;
}): void {
  const shared = pendingOwnerRecord(record.id);
  const sourceSession =
    name.startsWith("owner_") || name === "skip_confirmation"
      ? (shared?.sessionId ?? sessionId)
      : sessionId;
  recordAuditChange(sourceSession, before, record, name);
  if (sourceSession !== sessionId)
    mockStore(sourceSession).records.set(record.id, structuredClone(record));
  if (
    record.workflowState === "awaiting_owner_reapproval" ||
    record.skipReason ||
    name.startsWith("owner_")
  )
    publishOwnerRecord(sourceSession, record);
}
