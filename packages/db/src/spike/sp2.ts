import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { S3Client } from "@aws-sdk/client-s3";
import type { DataApiExecutor } from "../data-api.ts";
import {
  checkAuditChain,
  checkAuditRollback,
  checkIsolation,
  type RawCommitOptions,
} from "./isolation.ts";
import { checkLargeContent } from "./large-content.ts";
import { measureLatency } from "./latency.ts";
import { checkRoundTrips } from "./round-trips.ts";
import { checkAuditContent } from "./audit-content.ts";
export { measureLatency } from "./latency.ts";
export type { LatencyResult } from "./latency.ts";

export interface Sp2Options {
  executor: DataApiExecutor;
  rawCommit: RawCommitOptions;
  s3: S3Client;
  bucket: string;
  clientLocation: string;
}
export interface GateCheck {
  id: string;
  passed: boolean;
  details: unknown;
  timings: { startedAt: string; elapsedMs: number };
}
export interface Sp2Result {
  synthetic: true;
  companyIds: string[];
  passed: boolean;
  checks: GateCheck[];
}
export async function runSp2Gate(options: Sp2Options): Promise<Sp2Result> {
  const companies = { a: randomUUID(), b: randomUUID() };
  const checks: GateCheck[] = [];
  async function check(id: string, run: () => Promise<unknown>): Promise<void> {
    const start = performance.now();
    const startedAt = new Date().toISOString();
    try {
      checks.push({
        id,
        passed: true,
        details: await run(),
        timings: { startedAt, elapsedMs: performance.now() - start },
      });
    } catch (error) {
      checks.push({
        id,
        passed: false,
        details: {
          error: error instanceof Error ? error.message : "Gate check failed",
        },
        timings: { startedAt, elapsedMs: performance.now() - start },
      });
    }
  }
  await check("ISO-05", () => checkIsolation(options.executor, companies));
  await check("AUD-01", () =>
    checkAuditRollback(options.executor, options.rawCommit),
  );
  await check("PAR-01", () => checkRoundTrips(options.executor, companies.a));
  await check("LRG-01", () =>
    checkLargeContent(options.executor, options.s3, {
      companyId: companies.a,
      bucket: options.bucket,
    }),
  );
  await check("LAT-01", async () => {
    const result = await measureLatency(
      options.executor,
      options.clientLocation,
    );
    await checkAuditChain(options.executor, [result.companyId]);
    return result;
  });
  await check("AUD-CHAIN", async () => ({
    content: await checkAuditContent(options.executor),
    chain: await checkAuditChain(options.executor, [companies.a, companies.b]),
  }));
  return {
    synthetic: true,
    companyIds: [companies.a, companies.b],
    passed: checks.every(({ passed }) => passed),
    checks,
  };
}
