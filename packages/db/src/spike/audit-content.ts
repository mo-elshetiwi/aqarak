import type { DataApiExecutor } from "../data-api.ts";
import { assertGate } from "./fixtures.ts";

export const AUDIT_CONTENT_KEYS = [
  "event_id",
  "company_id",
  "seq",
  "occurred_at",
  "tx_id",
  "event_type",
  "actor_account_id",
  "actor_role",
  "on_behalf_of",
  "initiator",
  "channel",
  "subject_type",
  "subject_id",
  "version_before",
  "version_after",
  "changed_fields",
  "before_hash",
  "after_hash",
  "reason",
  "drafted_action_id",
  "field_provenance",
  "model_call_ids",
  "registry_entry",
  "prompt_version",
  "tool_version",
  "policy_decision",
  "idempotency_key",
  "trace_id",
  "visibility",
  "retention_class",
] as const;

export const AUDIT_KNOWN_HASH =
  "0ba068deed33b80852212dcff4dfe9c1a21d2be6068ce4d9b6a056e391ae5995";

export const AUDIT_KNOWN_ANSWER_SQL = `select encode(sha256(convert_to(
  repeat('0',64) || '|AQ-CANON-1|' || audit.canonical_text(
    '{"amount_fils":150000,"note":"عقد","rate":1.5}'::jsonb
  ), 'UTF8')), 'hex') as row_hash`;

export const AUDIT_PAYLOAD_KEYS_SQL = `with synthetic as (
  select audit.event_payload(jsonb_populate_record(null::audit.audit_event,
    '{"occurred_at":"2026-09-28T07:00:00.123456+04:00","tx_id":1234567890123456789}'::jsonb
  )) as payload
)
select (select jsonb_agg(key order by key collate "C") from jsonb_object_keys(payload) as keys(key)) as keys,
  payload->>'occurred_at' as occurred_at,
  jsonb_typeof(payload->'tx_id') as tx_id_type,
  payload->>'tx_id' as tx_id,
  payload->'reason' = 'null'::jsonb as empty_is_null
from synthetic`;

export async function checkAuditContent(
  executor: DataApiExecutor,
): Promise<Record<string, unknown>> {
  const hash = await executor.execute(AUDIT_KNOWN_ANSWER_SQL);
  assertGate(
    hash.rows[0]?.row_hash === AUDIT_KNOWN_HASH,
    "AQ-CANON-1 known-answer hash mismatch",
  );
  const result = await executor.execute(AUDIT_PAYLOAD_KEYS_SQL);
  const row = result.rows[0];
  const keys: unknown =
    typeof row?.keys === "string" ? JSON.parse(row.keys) : row?.keys;
  assertGate(
    JSON.stringify(keys) === JSON.stringify([...AUDIT_CONTENT_KEYS].sort()),
    "Audit payload must contain exactly the 30 shared content keys",
  );
  assertGate(
    row?.occurred_at === "2026-09-28T03:00:00.123456Z" &&
      row.tx_id_type === "number" &&
      row.tx_id === "1234567890123456789" &&
      row.empty_is_null === true,
    "Audit payload timestamp, transaction id or null encoding mismatch",
  );
  return { rowHash: AUDIT_KNOWN_HASH, keys, verified: true };
}
