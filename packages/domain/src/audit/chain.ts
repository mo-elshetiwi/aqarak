import { z } from "zod";
import { err, ok, type Result } from "../result";
import { auditEventCanonicalText, type AuditEventContent } from "./audit-event";
import { CANON_VERSION, GENESIS_PREV_HASH, computeRowHash } from "./canonical";

const chainRow = z
  .strictObject({
    seq: z.number().int().positive(),
    canon_version: z.string(),
    canonical_text: z.string(),
    prev_hash: z.string(),
    row_hash: z.string(),
  })
  .readonly();
const chainCheckpoint = z
  .strictObject({ seq: z.number().int().positive(), head_hash: z.string() })
  .readonly();
/** Validates the first failure reported by a chain verifier. */
export const chainBreak = z
  .strictObject({
    kind: z.enum([
      "seq_gap",
      "seq_out_of_order",
      "prev_hash_mismatch",
      "row_hash_mismatch",
      "head_mismatch",
      "behind_anchor",
    ]),
    seq: z.number().int().positive(),
  })
  .readonly();

/** Describes a persisted audit row when appending or verifying a chain. */
export type ChainRow = z.infer<typeof chainRow>;

/** Describes a stored chain head or independent checkpoint used for verification. */
export type ChainCheckpoint = z.infer<typeof chainCheckpoint>;

/** Identifies the first broken sequence when a chain fails verification. */
export type ChainBreak = z.infer<typeof chainBreak>;

/** Appends an event to an offline chain while the database remains the production writer.
 * @throws {RangeError} If the event does not have the next safe sequence number.
 * @throws {TypeError} If the head, event content or canonical text is malformed.
 */
export function appendToChain(
  head: ChainCheckpoint | null,
  content: AuditEventContent,
): { readonly row: ChainRow; readonly head: ChainCheckpoint } {
  if (head !== null && !chainCheckpoint.safeParse(head).success) {
    throw new TypeError("Invalid chain head");
  }
  const seq = head === null ? 1 : head.seq + 1;
  if (!Number.isSafeInteger(seq) || content.seq !== seq) {
    throw new RangeError("Audit sequence must be the next safe integer");
  }
  const prevHash = head === null ? GENESIS_PREV_HASH : head.head_hash;
  const canonicalText = auditEventCanonicalText(content);
  const rowHash = computeRowHash({
    prevHash,
    canonVersion: CANON_VERSION,
    canonicalText,
  });
  return {
    row: {
      seq,
      canon_version: CANON_VERSION,
      canonical_text: canonicalText,
      prev_hash: prevHash,
      row_hash: rowHash,
    },
    head: { seq, head_hash: rowHash },
  };
}

function rowProblem(
  row: ChainRow,
  previous: ChainCheckpoint | null,
): ChainBreak | null {
  const previousSeq = previous === null ? 0 : previous.seq;
  if (row.seq <= previousSeq) return { kind: "seq_out_of_order", seq: row.seq };
  if (row.seq !== previousSeq + 1)
    return { kind: "seq_gap", seq: previousSeq + 1 };
  const previousHash =
    previous === null ? GENESIS_PREV_HASH : previous.head_hash;
  if (row.prev_hash !== previousHash) {
    return { kind: "prev_hash_mismatch", seq: row.seq };
  }
  const expectedHash = computeRowHash({
    prevHash: row.prev_hash,
    canonVersion: row.canon_version,
    canonicalText: row.canonical_text,
  });
  return row.row_hash === expectedHash
    ? null
    : { kind: "row_hash_mismatch", seq: row.seq };
}

function sameCheckpoint(
  left: ChainCheckpoint | null,
  right: ChainCheckpoint | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.seq === right.seq && left.head_hash === right.head_hash;
}

/** Verifies a complete company chain, stored head and anchor, stopping at the first break.
 * @throws {TypeError} If row or checkpoint shapes or hashed text are malformed.
 */
export function verifyChain(input: {
  readonly rows: readonly ChainRow[];
  readonly head: ChainCheckpoint | null;
  readonly anchor: ChainCheckpoint | null;
}): Result<ChainCheckpoint | null, ChainBreak> {
  if (
    !chainCheckpoint.nullable().safeParse(input.head).success ||
    !chainCheckpoint.nullable().safeParse(input.anchor).success
  ) {
    throw new TypeError("Invalid chain checkpoint");
  }
  let previous: ChainCheckpoint | null = null;
  let anchorFound = input.anchor === null;
  for (const row of input.rows) {
    if (!chainRow.safeParse(row).success)
      throw new TypeError("Invalid chain row");
    const problem = rowProblem(row, previous);
    if (problem !== null) return err(problem);
    previous = { seq: row.seq, head_hash: row.row_hash };
    if (sameCheckpoint(previous, input.anchor)) anchorFound = true;
  }
  if (!sameCheckpoint(previous, input.head)) {
    return err({
      kind: "head_mismatch",
      seq: input.head?.seq ?? previous?.seq ?? 1,
    });
  }
  if (input.anchor !== null && !anchorFound) {
    return err({ kind: "behind_anchor", seq: input.anchor.seq });
  }
  return ok(previous);
}

const sessionUuid = z.string().regex(/^[0-9a-f]{4}(?:-?[0-9a-f]{4}){7}$/i);

function normalizedAccount(account: string | null): string | null {
  if (account === null) return null;
  const text =
    account.startsWith("{") && account.endsWith("}")
      ? account.slice(1, -1)
      : account;
  if (!sessionUuid.safeParse(text).success) {
    throw new TypeError("Actor and session account must be UUIDs or null");
  }
  return text.replaceAll("-", "").toLowerCase();
}

/** Compares UUID values with PostgreSQL input spellings, treating an empty session setting as null.
 * @throws {TypeError} If a nonempty actor or setting is not a UUID.
 */
export function isActorConsistent(
  eventActorAccountId: string | null,
  sessionAccountSetting: string | null,
): boolean {
  const session = sessionAccountSetting === "" ? null : sessionAccountSetting;
  return normalizedAccount(eventActorAccountId) === normalizedAccount(session);
}
