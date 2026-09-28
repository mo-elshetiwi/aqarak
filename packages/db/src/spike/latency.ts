import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { withSystemTx } from "../company-tx.ts";
import type { DataApiExecutor } from "../data-api.ts";
import { assertGate, cover, createCompany, uuid } from "./fixtures.ts";

export interface LatencyResult {
  location: string;
  warmups: number;
  samples: number;
  write: { p50Ms: number; p95Ms: number; samplesMs: number[] };
  read: { p50Ms: number; p95Ms: number; samplesMs: number[] };
  companyId: string;
}
export function percentiles(samples: readonly number[]): {
  p50Ms: number;
  p95Ms: number;
  samplesMs: number[];
} {
  if (
    !samples.length ||
    samples.some((value) => !Number.isFinite(value) || value < 0)
  )
    throw new Error("Latency samples must be finite non-negative numbers");
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (percentile: number): number =>
    sorted[Math.ceil(sorted.length * percentile) - 1] ?? 0;
  return { p50Ms: at(0.5), p95Ms: at(0.95), samplesMs: [...samples] };
}
export async function measureLatency(
  executor: DataApiExecutor,
  location: string,
): Promise<LatencyResult> {
  const companyId = await createCompany(executor);
  const writes: number[] = [];
  const reads: number[] = [];
  for (let index = 0; index < 22; index++) {
    const documentId = randomUUID();
    const started = performance.now();
    await withSystemTx(executor, { companyId }, async (tx) => {
      await tx.execute(
        "insert into doc.document(id, company_id, subject_type, subject_id, doc_type, title, sensitivity) values (:id, :company, 'company', :company, 'other', 'SP2 spike latency', 'general')",
        [uuid("id", documentId), uuid("company", companyId)],
      );
      await cover(tx, companyId, "document", documentId);
    });
    const written = performance.now();
    await withSystemTx(executor, { companyId }, async (tx) => {
      const result = await tx.execute(
        "select id::text as id from doc.document where id = :id",
        [uuid("id", documentId)],
      );
      assertGate(
        result.rows[0]?.id === documentId,
        "Latency read did not return its synthetic row",
      );
    });
    const finished = performance.now();
    if (index >= 2) {
      writes.push(written - started);
      reads.push(finished - written);
    }
  }
  return {
    location,
    warmups: 2,
    samples: 20,
    write: percentiles(writes),
    read: percentiles(reads),
    companyId,
  };
}
