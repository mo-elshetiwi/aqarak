import { randomUUID } from "node:crypto";
import {
  appendToChain,
  err,
  ok,
  type ChainCheckpoint,
  type ChainRow,
  type ContractDecision,
  type Result,
} from "@aqarak/domain";
import { MOCK_ACCOUNT_IDS, MOCK_ACCOUNTS } from "@/lib/api/mock-fixtures";
import type {
  ClauseSuggestion,
  ContractDetail,
  ContractNotification,
  Problem,
} from "./schemas";
interface NotificationRecord {
  companyId: string;
  recipientId: string;
  item: ContractNotification;
}
export interface MockActivity {
  notifications: Map<string, NotificationRecord>;
  reads: Map<string, { id: string; result: { id: string; readAt: string } }>;
  rows: ChainRow[];
  head: ChainCheckpoint | null;
}
export function createMockActivity(): MockActivity {
  return { notifications: new Map(), reads: new Map(), rows: [], head: null };
}
export function recordActivity(
  activity: MockActivity,
  detail: ContractDetail,
  input: {
    companyId: string;
    accountId: string;
    slot: "manager" | "owner" | "tenant" | "reader";
    now: string;
    reason: string | undefined;
    decision: ContractDecision;
  },
): void {
  if (input.slot === "reader")
    throw new Error("Readers cannot write contract decisions");
  for (const event of input.decision.events) {
    const appended = appendToChain(activity.head, {
      event_id: randomUUID(),
      company_id: input.companyId,
      seq: activity.rows.length + 1,
      occurred_at: input.now,
      tx_id: String(activity.rows.length + 1),
      event_type: event,
      actor_account_id: input.accountId,
      actor_role: input.slot,
      on_behalf_of: null,
      initiator: "person",
      channel: "web_form",
      subject_type: "contract",
      subject_id: detail.contract.id,
      version_before: null,
      version_after: detail.version.versionNo,
      changed_fields: [],
      before_hash: null,
      after_hash: detail.version.contentHash,
      reason: input.reason ?? null,
      drafted_action_id: null,
      ...auditProvenance(detail, event),
      model_call_ids: [],
      tool_version: null,
      policy_decision: null,
      idempotency_key: null,
      trace_id: null,
      visibility: "parties",
      retention_class: "company_lifetime",
    });
    activity.rows.push(appended.row);
    activity.head = appended.head;
  }
  for (const effect of input.decision.effects) {
    if (effect.type !== "notify") continue;
    const handle = `${effect.recipient}-1` as const;
    const recipientId = effect.accountId ?? MOCK_ACCOUNT_IDS[handle];
    const id = randomUUID();
    const item: ContractNotification = {
      id,
      templateCode: effect.template,
      subjectType: "contract",
      subjectId: detail.contract.id,
      contractId: detail.contract.id,
      createdAt: input.now,
      readAt: null,
    };
    activity.notifications.set(id, {
      companyId: input.companyId,
      recipientId,
      item,
    });
    detail.deliveries.push({
      notificationId: id,
      recipientName:
        MOCK_ACCOUNTS.find((account) => account.handle === handle)?.name.en ??
        "",
      channel: "in_app",
      templateCode: effect.template,
      status: "delivered",
      createdAt: input.now,
      lastErrorCode: null,
      attempts: 0,
      deadLettered: false,
    });
    detail.deliveries.push({
      notificationId: randomUUID(),
      recipientName:
        MOCK_ACCOUNTS.find((account) => account.handle === handle)?.name.en ??
        "",
      channel: "email",
      templateCode: effect.template,
      status: "failed",
      createdAt: input.now,
      lastErrorCode: "MessageRejected",
      attempts: 1,
      deadLettered: false,
    });
  }
}
export function notificationList(
  activity: MockActivity,
  scope: { accountId: string; companyId: string },
  limit = 50,
): { unreadCount: number; items: ContractNotification[] } {
  const records = [...activity.notifications.values()]
    .filter(
      (entry) =>
        entry.companyId === scope.companyId &&
        entry.recipientId === scope.accountId,
    )
    .sort((a, b) => b.item.createdAt.localeCompare(a.item.createdAt));
  return {
    unreadCount: records.filter((entry) => !entry.item.readAt).length,
    items: structuredClone(records.slice(0, limit).map((entry) => entry.item)),
  };
}
export function readNotification(
  activity: MockActivity,
  scope: { accountId: string; companyId: string },
  input: { id: string; key: string; now: string },
): Result<{ id: string; readAt: string }, Problem> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(input.key))
    return err({ status: 400, code: "VALIDATION_FAILED" });
  const replayKey = `${scope.accountId}:${scope.companyId}:${input.key}`;
  const previous = activity.reads.get(replayKey);
  if (previous)
    return previous.id === input.id
      ? ok(structuredClone(previous.result))
      : err({ status: 422, code: "IDEMPOTENCY_KEY_REUSED" });
  const record = activity.notifications.get(input.id);
  if (
    record?.companyId !== scope.companyId ||
    record.recipientId !== scope.accountId
  )
    return err({ status: 404, code: "NOT_FOUND" });
  record.item.readAt ??= input.now;
  const result = { id: input.id, readAt: record.item.readAt };
  activity.reads.set(replayKey, { id: input.id, result });
  return ok(structuredClone(result));
}

function clauseProvenance(
  detail: ContractDetail,
): Record<string, "ai_confirmed" | "ai_edited"> | null {
  const fields: Record<string, "ai_confirmed" | "ai_edited"> = {};
  for (const clause of detail.version.specialClauses) {
    if (!clause.suggestion) continue;
    fields[`clause_${String(clause.position)}`] =
      clause.suggestion.confirmation;
  }
  return Object.keys(fields).length ? fields : null;
}

function auditProvenance(
  detail: ContractDetail,
  event: string,
): {
  field_provenance: ReturnType<typeof clauseProvenance>;
  registry_entry: string | null;
  prompt_version: string | null;
} {
  const recorded = event === "contract.created" || event === "contract.updated";
  const first = recorded
    ? detail.version.specialClauses.find((clause) => clause.suggestion)
        ?.suggestion
    : null;
  return {
    field_provenance: recorded ? clauseProvenance(detail) : null,
    registry_entry: first?.registryEntry ?? null,
    prompt_version: first?.promptVersion ?? null,
  };
}

export function recordSuggestionActivity(
  activity: MockActivity,
  input: { companyId: string; accountId: string; now: string; key: string },
  value: ClauseSuggestion,
): void {
  const appended = appendToChain(activity.head, {
    event_id: randomUUID(),
    company_id: input.companyId,
    seq: activity.rows.length + 1,
    occurred_at: input.now,
    tx_id: String(activity.rows.length + 1),
    event_type: "clause_suggestion.created",
    actor_account_id: input.accountId,
    actor_role: "manager",
    on_behalf_of: null,
    initiator: "person",
    channel: "web_form",
    subject_type: "clause_suggestion",
    subject_id: value.suggestionId,
    version_before: null,
    version_after: 1,
    changed_fields: [],
    before_hash: null,
    after_hash: null,
    reason: null,
    drafted_action_id: null,
    registry_entry: value.provenance.registryEntry,
    prompt_version: value.provenance.promptVersion,
    field_provenance: null,
    model_call_ids: [],
    tool_version: null,
    policy_decision: null,
    idempotency_key: input.key,
    trace_id: null,
    visibility: "parties",
    retention_class: "company_lifetime",
  });
  activity.rows.push(appended.row);
  activity.head = appended.head;
}
