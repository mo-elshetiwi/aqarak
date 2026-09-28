import "server-only";
import { randomUUID } from "node:crypto";
import {
  CANON_VERSION,
  GENESIS_PREV_HASH,
  computeRowHash,
  encodeCanonical,
  sha256Hex,
  verifyChain,
} from "@aqarak/domain";
import { getMessages } from "@aqarak/i18n";
import {
  MOCK_ACCOUNT_IDS,
  MOCK_ACCOUNTS,
  MOCK_COMPANY_A_ID,
} from "@/lib/api/mock-fixtures";
import { seedRecords } from "../../tawtheeq/_lib/fixtures";
import type { TawtheeqRecord } from "../../tawtheeq/_lib/schemas";
import type { Anchor, AuditEvent, Verification, Versions } from "./schemas";
type Snapshot = Versions["versions"][number]["snapshot"];
interface AuditStore {
  events: AuditEvent[];
  histories: Map<string, Versions>;
  anchor: Anchor | null;
  replays: Map<string, Anchor | Verification>;
}
const scope = globalThis as typeof globalThis & {
  syntheticAuditStores?: Map<string, AuditStore>;
};
export function canonicalEvent(event: AuditEvent): string {
  return encodeCanonical(
    Object.fromEntries(
      Object.entries(event).filter(
        ([key]) => key !== "prevHash" && key !== "rowHash",
      ),
    ),
  );
}
export function appendEvent(
  store: AuditStore,
  input: Partial<AuditEvent> = {},
): AuditEvent {
  const actor = MOCK_ACCOUNTS.find((a) => a.handle === "manager-1");
  const previous = store.events.at(-1);
  const event: AuditEvent = {
    seq: (previous?.seq ?? 0) + 1,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    eventType: "contract.created",
    refused: false,
    actor: {
      accountId: MOCK_ACCOUNT_IDS["manager-1"],
      displayName: actor?.name.en ?? null,
      role: "manager",
    },
    initiator: "person",
    channel: "web_form",
    subject: {
      type: "company",
      id: MOCK_COMPANY_A_ID,
      versionBefore: null,
      versionAfter: null,
    },
    reason: null,
    changedFields: [],
    details: {},
    modelCallIds: [],
    registryEntry: null,
    promptVersion: null,
    prevHash: previous?.rowHash ?? GENESIS_PREV_HASH,
    rowHash: "",
    ...input,
  };
  event.rowHash = computeRowHash({
    prevHash: event.prevHash,
    canonVersion: CANON_VERSION,
    canonicalText: canonicalEvent(event),
  });
  store.events.push(event);
  return event;
}
function addVersion(
  store: AuditStore,
  entry: {
    type: Versions["subject"]["type"];
    id: string;
    version: number;
    snapshot: Snapshot;
    event: AuditEvent;
  },
): void {
  const { type, id, version, snapshot, event } = entry;
  const key = `${type}:${id}`;
  const history = store.histories.get(key) ?? {
    subject: { type, id },
    versions: [],
  };
  if (history.versions.some((v) => v.version === version)) return;
  const previous = history.versions.at(-1)?.snapshot ?? {};
  history.versions.push({
    version,
    snapshot,
    recordedAt: event.occurredAt,
    snapshotSha256: sha256Hex(encodeCanonical(snapshot)),
    event: {
      seq: event.seq,
      eventType: event.eventType,
      actorDisplayName: event.actor?.displayName ?? null,
      actorRole: event.actor?.role ?? null,
      reason: event.reason,
    },
    diff: [...new Set([...Object.keys(previous), ...Object.keys(snapshot)])]
      .filter(
        (field) =>
          JSON.stringify(previous[field]) !== JSON.stringify(snapshot[field]),
      )
      .map((field) => ({
        field,
        before: previous[field] ?? null,
        after: snapshot[field] ?? null,
      })),
  });
  store.histories.set(key, history);
}
function recordSnapshot(record: TawtheeqRecord): Snapshot {
  return {
    workflow_state: record.workflowState,
    portal_status: record.portalStatus,
    skip_reason: record.skipReason,
    return_reason: record.returnReason,
    tawtheeq_number: record.tawtheeqNumber,
    registered_on: record.registeredOn,
  };
}
function contractSnapshot(record: TawtheeqRecord): Snapshot {
  return {
    annual_rent_fils: record.contract.annualRentFils,
    deposit_fils: record.contract.depositFils,
    term_start: record.contract.termStart,
    term_end: record.contract.termEnd,
    current_version_id: record.contract.currentVersionId,
  };
}
function seed(): AuditStore {
  const store: AuditStore = {
    events: [],
    histories: new Map(),
    anchor: null,
    replays: new Map(),
  };
  const records = seedRecords();
  for (const record of records) {
    const event = appendEvent(store, {
      occurredAt: "2026-09-28T05:00:00.000Z",
      eventType: "tawtheeq.created",
      details: { label: record.contract.contractNo },
      subject: {
        type: "tawtheeq_record",
        id: record.id,
        versionBefore: null,
        versionAfter: record.version,
      },
    });
    addVersion(store, {
      type: "tawtheeq_record",
      id: record.id,
      version: record.version,
      snapshot: recordSnapshot(record),
      event,
    });
    addVersion(store, {
      type: "contract",
      id: record.contractId,
      version: record.contract.versionNo,
      snapshot: contractSnapshot(record),
      event,
    });
    addVersion(store, {
      type: "contract_version",
      id: record.contract.currentVersionId,
      version: 1,
      snapshot: contractSnapshot(record),
      event,
    });
    for (const d of record.discrepancies)
      addVersion(store, {
        type: "discrepancy",
        id: d.id,
        version: 1,
        snapshot: {
          field: d.field,
          status: d.status,
          contract_value: d.contractValue,
          registered_value: d.registeredValue,
        },
        event,
      });
  }
  appendEvent(store, {
    occurredAt: "2026-09-28T05:41:08.000Z",
    eventType: "extraction.created",
    actor: null,
    initiator: "pipeline",
    channel: "system",
    registryEntry: "synthetic.fixture",
    promptVersion: "v1",
  });
  appendEvent(store, {
    occurredAt: "2026-09-28T06:42:17.000Z",
    eventType: "drafted_action.committed",
    initiator: "co_worker",
    channel: "voice",
    reason: getMessages("en").Audit.sampleDraft,
    details: { syntheticReasonKey: "sampleDraft" },
  });
  const owner = MOCK_ACCOUNTS.find((a) => a.handle === "owner-2");
  appendEvent(store, {
    occurredAt: "2026-09-28T12:22:51.000Z",
    eventType: "policy.denied",
    refused: true,
    actor: {
      accountId: MOCK_ACCOUNT_IDS["owner-2"],
      displayName: owner?.name.en ?? null,
      role: "owner",
    },
    subject: {
      type: "contract",
      id: "61000000-0000-4000-8000-000000000001",
      versionBefore: 1,
      versionAfter: 1,
    },
    reason: getMessages("en").Audit.sampleDenied,
    details: { syntheticReasonKey: "sampleDenied", label: "C-01" },
  });
  return store;
}
export function auditStore(sessionId: string): AuditStore {
  scope.syntheticAuditStores ??= new Map();
  let store = scope.syntheticAuditStores.get(sessionId);
  if (!store) {
    store = seed();
    scope.syntheticAuditStores.set(sessionId, store);
  }
  return store;
}
export function resetAuditStores(): void {
  delete scope.syntheticAuditStores;
}
export function tamperSyntheticChain(sessionId: string): void {
  const event = auditStore(sessionId).events.find((e) => e.seq === 7);
  if (event) event.details = { ...event.details, tampered: true };
}
export function verifySynthetic(store: AuditStore): Verification {
  const head = store.events.at(-1);
  const result = verifyChain({
    rows: store.events.map((event) => ({
      seq: event.seq,
      canon_version: CANON_VERSION,
      canonical_text: canonicalEvent(event),
      prev_hash: event.prevHash,
      row_hash: event.rowHash,
    })),
    head: head ? { seq: head.seq, head_hash: head.rowHash } : null,
    anchor: store.anchor
      ? { seq: store.anchor.seq, head_hash: store.anchor.headHash }
      : null,
  });
  return {
    ok: result.ok,
    checkedAt: new Date().toISOString(),
    eventCount: store.events.length,
    firstSeq: store.events[0]?.seq ?? null,
    lastSeq: head?.seq ?? null,
    headHash: head?.rowHash ?? null,
    anchor: store.anchor,
    anchorProblem: null,
    sql: {
      ok: result.ok,
      firstBadSeq: result.ok ? null : result.error.seq,
      problem: result.ok ? null : result.error.kind,
    },
    recomputed: { ok: result.ok, break: result.ok ? null : result.error },
  };
}
export function recordAuditChange(
  sessionId: string,
  before: TawtheeqRecord,
  after: TawtheeqRecord,
  operation: string,
): void {
  if (before.version === after.version) return;
  const store = auditStore(sessionId);
  const event = appendEvent(store, {
    ...ownerActor(operation),
    eventType: `tawtheeq.${operation}`,
    details: { label: after.contract.contractNo },
    subject: {
      type: "tawtheeq_record",
      id: after.id,
      versionBefore: before.version,
      versionAfter: after.version,
    },
    changedFields: Object.keys(recordSnapshot(after)).filter(
      (key) => recordSnapshot(before)[key] !== recordSnapshot(after)[key],
    ),
    reason: after.returnReason ?? after.skipReason,
  });
  addVersion(store, {
    type: "tawtheeq_record",
    id: after.id,
    version: after.version,
    snapshot: recordSnapshot(after),
    event,
  });
  for (const d of after.discrepancies) {
    const old = before.discrepancies.find((item) => item.id === d.id);
    if (JSON.stringify(old) !== JSON.stringify(d))
      addVersion(store, {
        type: "discrepancy",
        id: d.id,
        version:
          (store.histories.get(`discrepancy:${d.id}`)?.versions.length ?? 0) +
          1,
        snapshot: {
          field: d.field,
          status: d.status,
          contract_value: d.contractValue,
          registered_value: d.registeredValue,
          resolution: d.resolution?.kind ?? null,
        },
        event,
      });
  }
  if (
    after.adoption &&
    before.adoption?.contractVersionId !== after.adoption.contractVersionId
  )
    addVersion(store, {
      type: "contract_version",
      id: after.adoption.contractVersionId,
      version: 1,
      snapshot: { ...contractSnapshot(after), ...after.adoption.changedFields },
      event,
    });
  if (after.contract.versionNo !== before.contract.versionNo)
    addVersion(store, {
      type: "contract",
      id: after.contractId,
      version: after.contract.versionNo,
      snapshot: contractSnapshot(after),
      event,
    });
}

function ownerActor(operation: string): Partial<AuditEvent> {
  if (!operation.startsWith("owner_") && operation !== "skip_confirmation")
    return {};
  const owner = MOCK_ACCOUNTS.find((account) => account.handle === "owner-1");
  return {
    actor: {
      accountId: MOCK_ACCOUNT_IDS["owner-1"],
      displayName: owner?.name.en ?? null,
      role: "owner",
    },
  };
}
