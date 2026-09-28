import "server-only";
import { MOCK_COMPANY_A_ID } from "@/lib/api/mock-fixtures";
import type { AuditClient } from "./client";
import type { AuditEvent, AuditFilters, AuditResult } from "./schemas";
import { appendEvent, auditStore, verifySynthetic } from "./mock-store";
function filtered(events: AuditEvent[], f: AuditFilters): AuditEvent[] {
  return events
    .filter(
      (e) =>
        (!f.subjectType || e.subject.type === f.subjectType) &&
        (!f.subjectId || e.subject.id === f.subjectId) &&
        (!f.actorAccountId || e.actor?.accountId === f.actorAccountId) &&
        (!f.eventType || e.eventType === f.eventType) &&
        (!f.initiator || e.initiator === f.initiator) &&
        (f.refusalsOnly !== "true" || e.refused) &&
        (!f.afterSeq || e.seq < f.afterSeq),
    )
    .sort((a, b) => b.seq - a.seq);
}
export function csvCell(value: string | number | null): string {
  const raw = value === null ? "" : String(value);
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(guarded)
    ? `"${guarded.replaceAll('"', '""')}"`
    : guarded;
}
export function syntheticCsv(events: AuditEvent[]): string {
  const header =
    "seq,occurred_at,event_type,actor_account_id,actor_name,actor_role,initiator,channel,subject_type,subject_id,version_before,version_after,reason,prev_hash,row_hash";
  const rows = events.map((e) =>
    [
      e.seq,
      e.occurredAt,
      e.eventType,
      e.actor?.accountId ?? null,
      e.actor?.displayName ?? null,
      e.actor?.role ?? null,
      e.initiator,
      e.channel,
      e.subject.type,
      e.subject.id,
      e.subject.versionBefore,
      e.subject.versionAfter,
      e.reason,
      e.prevHash,
      e.rowHash,
    ]
      .map(csvCell)
      .join(","),
  );
  return `\uFEFF${[header, ...rows].join("\r\n")}\r\n`;
}
export function createAuditMockClient(
  companyId: string,
  sessionId: string,
): AuditClient {
  const store = auditStore(sessionId);
  function result<T>(value: T): AuditResult<T> {
    return companyId === MOCK_COMPANY_A_ID
      ? { ok: true, value: structuredClone(value) }
      : { ok: false, error: { status: 403, code: "NOT_PERMITTED" } };
  }
  return {
    events: (filters) => {
      const events = filtered(store.events, filters);
      const limit = Math.min(filters.limit ?? 50, 100);
      return Promise.resolve(
        result({
          events: events.slice(0, limit),
          nextCursor:
            events.length > limit ? (events[limit - 1]?.seq ?? null) : null,
        }),
      );
    },
    versions: (type, id) => {
      const history = store.histories.get(`${type}:${id}`);
      return Promise.resolve(
        history
          ? result(history)
          : { ok: false, error: { status: 404, code: "NOT_FOUND" } },
      );
    },
    verify: (key) => {
      const replay = store.replays.get(`verify:${key}`);
      const value =
        replay && "checkedAt" in replay ? replay : verifySynthetic(store);
      if (!replay && companyId === MOCK_COMPANY_A_ID) {
        store.replays.set(`verify:${key}`, value);
        appendEvent(store, { eventType: "chain.verified" });
      }
      return Promise.resolve(result(value));
    },
    anchor: (key) => {
      const head = store.events.at(-1);
      if (!head)
        return Promise.resolve({
          ok: false,
          error: { status: 422, code: "INVALID_TRANSITION" },
        });
      const replay = store.replays.get(`anchor:${key}`);
      const value =
        replay && "key" in replay
          ? replay
          : {
              seq: head.seq,
              headHash: head.rowHash,
              anchoredAt: new Date().toISOString(),
              objectVersionId: `synthetic-${String(head.seq)}`,
              key: `synthetic/${companyId}/${String(head.seq)}`,
            };
      if (!replay && companyId === MOCK_COMPANY_A_ID) {
        store.anchor = value;
        store.replays.set(`anchor:${key}`, value);
        appendEvent(store, { eventType: "chain.anchored" });
      }
      return Promise.resolve(result(value));
    },
    exportCsv: (filters) => {
      if (companyId !== MOCK_COMPANY_A_ID)
        return Promise.resolve({
          ok: false,
          error: { status: 403, code: "NOT_PERMITTED" },
        });
      const csv = syntheticCsv(
        filtered(store.events, filters).slice(0, filters.limit ?? 5000),
      );
      appendEvent(store, { eventType: "export.performed" });
      return Promise.resolve({
        ok: true,
        value: {
          body: new Blob([csv]).stream(),
          disposition: `attachment; filename="audit-${companyId}-${new Date()
            .toISOString()
            .replaceAll(/[-:]/g, "")
            .replace(/\.\d{3}Z$/, "Z")}.csv"`,
        },
      });
    },
  };
}
