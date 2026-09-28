import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  encodeCanonical,
  sha256Hex,
  verifyChain,
  type ChainRow,
  type ChainBreak,
} from "@aqarak/domain";
import type { CompanyTransaction } from "@aqarak/db";
import { z } from "zod";
import {
  Refusal,
  writeAuditEvent,
  coverTransactionVersions,
  type CommandContext,
  type KernelDependencies,
} from "./kernel";

const positive = z.coerce.number().int().positive();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const checkpoint = z.strictObject({ seq: positive, head_hash: hash });
const chainRow = z.strictObject({
  seq: positive,
  canon_version: z.string(),
  canonical_text: z.string(),
  prev_hash: hash,
  row_hash: hash,
});
const anchorRow = z.strictObject({
  seq: positive,
  head_hash: hash,
  anchored_at: z.iso.datetime(),
  bucket: z.string().min(1),
  s3_key: z.string().min(1),
  s3_version_id: z.string().min(1),
  object_sha256: hash,
});
type AnchorRow = z.infer<typeof anchorRow>;
const anchorObject = z.strictObject({
  companyId: z.uuid(),
  seq: positive,
  headHash: hash,
  anchoredAt: z.iso.datetime(),
  canonVersion: z.literal("AQ-CANON-1"),
});

async function readHead(
  tx: CompanyTransaction,
  companyId: string,
): Promise<z.infer<typeof checkpoint> | null> {
  const result = await tx.execute(
    "select seq, head_hash from audit.chain_head_of(:company::uuid)",
    [{ name: "company", value: companyId }],
  );
  return result.rows[0] ? checkpoint.parse(result.rows[0]) : null;
}

/** Writes the command's one declared event and covers its business versions. */
export async function commandEvent(
  ctx: CommandContext,
  eventType: string,
  details: Record<string, unknown>,
): Promise<void> {
  const event = await writeAuditEvent(ctx.tx, ctx.companyId, {
    eventType,
    actorAccountId: ctx.actor.account_id,
    actorRole: ctx.actor.roles[0] ?? null,
    initiator: "person",
    channel: ctx.channel,
    subjectType: "company",
    subjectId: ctx.companyId,
    versionBefore: null,
    versionAfter: null,
    details,
    traceId: ctx.traceId,
    idempotencyKey: ctx.idempotencyKey,
  });
  await coverTransactionVersions(ctx.tx, ctx.companyId, event.eventId);
}

async function anchorProblem(
  deps: KernelDependencies,
  companyId: string,
  anchor: AnchorRow | null,
): Promise<string | null> {
  if (anchor === null) return null;
  try {
    const object = await deps.s3.send(
      new GetObjectCommand({
        Bucket: anchor.bucket,
        Key: anchor.s3_key,
        VersionId: anchor.s3_version_id,
      }),
    );
    if (!object.Body) return "Anchor object is missing.";
    const text = await object.Body.transformToString();
    if (sha256Hex(text) !== anchor.object_sha256)
      return "Anchor object checksum differs.";
    const parsed: unknown = JSON.parse(text);
    const value = anchorObject.parse(parsed);
    if (
      value.companyId !== companyId ||
      value.seq !== anchor.seq ||
      value.headHash !== anchor.head_hash ||
      value.anchoredAt !== new Date(anchor.anchored_at).toISOString()
    )
      return "Anchor object does not match its checkpoint.";
    if (!object.ObjectLockMode || !object.ObjectLockRetainUntilDate)
      return "Anchor object has no retention lock.";
    return null;
  } catch {
    return "Anchor object could not be read or validated.";
  }
}

export interface VerificationView {
  readonly ok: boolean;
  readonly checkedAt: string;
  readonly eventCount: number;
  readonly firstSeq: number | null;
  readonly lastSeq: number | null;
  readonly headHash: string | null;
  readonly anchor: {
    seq: number;
    headHash: string;
    anchoredAt: string;
    objectVersionId: string;
  } | null;
  readonly anchorProblem: string | null;
  readonly sql: {
    ok: boolean;
    firstBadSeq: number | null;
    problem: string | null;
  };
  readonly recomputed: { ok: boolean; break: ChainBreak | null };
}

async function readChainRows(
  tx: CompanyTransaction,
  params: { name: string; value: string }[],
): Promise<ChainRow[]> {
  const rows: ChainRow[] = [];
  let after = 0;
  for (;;) {
    const page = await tx.execute(
      `select e.seq, e.canon_version, audit.canonical_text(audit.event_payload(e)) as canonical_text,
      e.prev_hash, e.row_hash from audit.audit_event e where e.company_id = :company::uuid and e.seq > :after::bigint
      order by e.seq limit 500`,
      [...params, { name: "after", value: after }],
    );
    const parsed = z.array(chainRow).parse(page.rows);
    rows.push(...parsed);
    const last = parsed.at(-1);
    if (parsed.length < 500 || !last) break;
    after = last.seq;
  }
  return rows;
}

/** Verifies paged canonical SQL payloads against both the stored head and locked object anchor. */
export async function verifyCompany(
  ctx: CommandContext,
  deps: KernelDependencies,
): Promise<VerificationView> {
  const params = [{ name: "company", value: ctx.companyId }];
  // Holding the head lock prevents concurrent appenders changing the verification range.
  const head = await readHead(ctx.tx, ctx.companyId);
  const sqlRows = await ctx.tx.execute(
    "select ok, first_bad_seq, problem from audit.verify_chain(:company::uuid)",
    params,
  );
  const sql = z
    .strictObject({
      ok: z.boolean(),
      first_bad_seq: positive.nullable(),
      problem: z.string().nullable(),
    })
    .parse(sqlRows.rows[0]);
  const rows = await readChainRows(ctx.tx, params);
  const anchors = await ctx.tx.execute(
    `select seq, head_hash,
    to_char(anchored_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as anchored_at,
    bucket, s3_key, s3_version_id, object_sha256 from audit.chain_anchor
    where company_id = :company::uuid order by seq desc, anchored_at desc limit 1`,
    params,
  );
  const anchor = anchors.rows[0] ? anchorRow.parse(anchors.rows[0]) : null;
  const problem = await anchorProblem(deps, ctx.companyId, anchor);
  const recomputed = verifyChain({
    rows,
    head,
    anchor:
      anchor === null ? null : { seq: anchor.seq, head_hash: anchor.head_hash },
  });
  const result: VerificationView = {
    ok: sql.ok && recomputed.ok && problem === null,
    checkedAt: ctx.now.toISOString(),
    eventCount: rows.length,
    firstSeq: rows[0]?.seq ?? null,
    lastSeq: rows.at(-1)?.seq ?? null,
    headHash: head?.head_hash ?? null,
    anchor:
      anchor === null
        ? null
        : {
            seq: anchor.seq,
            headHash: anchor.head_hash,
            anchoredAt: anchor.anchored_at,
            objectVersionId: anchor.s3_version_id,
          },
    anchorProblem: problem,
    sql: { ok: sql.ok, firstBadSeq: sql.first_bad_seq, problem: sql.problem },
    recomputed: {
      ok: recomputed.ok,
      break: recomputed.ok ? null : recomputed.error,
    },
  };
  await recordVerification(ctx, result);
  return result;
}

async function recordVerification(
  ctx: CommandContext,
  result: VerificationView,
): Promise<void> {
  await commandEvent(ctx, "chain.verified", {
    ok: result.ok,
    lastSeq: result.lastSeq,
    anchorSeq: result.anchor?.seq ?? null,
    breakKind: result.recomputed.break?.kind ?? null,
    breakSeq: result.recomputed.break?.seq ?? null,
  });
}

export interface AnchorView {
  readonly seq: number;
  readonly headHash: string;
  readonly anchoredAt: string;
  readonly objectVersionId: string;
  readonly key: string;
}

/** Stores a canonical checkpoint using the bucket's default Object Lock retention. */
export async function anchorCompany(
  ctx: CommandContext,
  deps: KernelDependencies,
): Promise<AnchorView> {
  const bucket = deps.buckets.auditAnchors;
  if (!bucket) {
    process.stderr.write("Missing configuration: AUDIT_ANCHORS_BUCKET_NAME\n");
    throw new Refusal("UNAVAILABLE", null);
  }
  const head = await readHead(ctx.tx, ctx.companyId);
  if (!head)
    throw new Refusal("INVALID_TRANSITION", {
      type: "company",
      id: ctx.companyId,
    });
  const anchoredAt = ctx.now.toISOString();
  const body = encodeCanonical({
    companyId: ctx.companyId,
    seq: head.seq,
    headHash: head.head_hash,
    anchoredAt,
    canonVersion: "AQ-CANON-1",
  });
  const digest = sha256Hex(body);
  const key = `${deps.keyPrefix}companies/${ctx.companyId}/audit-anchors/${String(head.seq)}-${head.head_hash}.json`;
  const object = await deps.s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "application/json",
      ChecksumSHA256: Buffer.from(digest, "hex").toString("base64"),
    }),
  );
  const objectVersionId = z.string().min(1).parse(object.VersionId);
  await ctx.tx.execute(
    `insert into audit.chain_anchor(company_id, seq, head_hash, bucket, s3_key, s3_version_id, object_sha256, anchored_at, anchored_by)
    values (:company::uuid, :seq::bigint, :hash, :bucket, :key, :version, :digest, :at::timestamptz, :actor::uuid)`,
    [
      { name: "company", value: ctx.companyId },
      { name: "seq", value: head.seq },
      { name: "hash", value: head.head_hash },
      { name: "bucket", value: bucket },
      { name: "key", value: key },
      { name: "version", value: objectVersionId },
      { name: "digest", value: digest },
      { name: "at", value: anchoredAt },
      { name: "actor", value: ctx.actor.account_id },
    ],
  );
  await commandEvent(ctx, "chain.anchored", {
    seq: head.seq,
    headHash: head.head_hash,
    objectVersionId,
  });
  return {
    seq: head.seq,
    headHash: head.head_hash,
    anchoredAt,
    objectVersionId,
    key,
  };
}
