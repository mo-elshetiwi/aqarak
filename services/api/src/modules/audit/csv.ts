import type { AuditEventView } from "./views";
const columns = [
  "seq",
  "occurred_at",
  "event_type",
  "actor_account_id",
  "actor_name",
  "actor_role",
  "initiator",
  "channel",
  "subject_type",
  "subject_id",
  "version_before",
  "version_after",
  "reason",
  "prev_hash",
  "row_hash",
];

/** Escapes RFC 4180 cells and guards spreadsheet formulas before quoting. */
export function csvCell(value: string | number | null): string {
  const raw = value === null ? "" : String(value);
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(guarded)
    ? `"${guarded.replaceAll('"', '""')}"`
    : guarded;
}

/** Returns UTF-8 CSV text with a byte order mark and CRLF records. */
export function encodeCsv(events: readonly AuditEventView[]): string {
  const rows = events.map((event) =>
    [
      event.seq,
      event.occurredAt,
      event.eventType,
      event.actor?.accountId ?? null,
      event.actor?.displayName ?? null,
      event.actor?.role ?? null,
      event.initiator,
      event.channel,
      event.subject.type,
      event.subject.id,
      event.subject.versionBefore,
      event.subject.versionAfter,
      event.reason,
      event.prevHash,
      event.rowHash,
    ]
      .map(csvCell)
      .join(","),
  );
  return `\uFEFF${[columns.join(","), ...rows].join("\r\n")}\r\n`;
}
