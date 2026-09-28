import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { DataApiExecutor, Row } from "../src/data-api.ts";
import { loadMigrations } from "../src/migrate.ts";
import { CANONICAL_CASES } from "../src/spike/isolation.ts";
import { localExecutor, localOptions } from "./cli.ts";

export interface CanonicalVector {
  id: string;
  input: string;
  expected?: string;
}
interface Observation {
  canonical: string;
  utf8Sha256: string;
  serverMs: number;
}
interface CaseResult extends CanonicalVector {
  before: Observation;
  after?: Observation;
  equal?: boolean;
}
interface Snapshot {
  capturedAt: string;
  ledger: Row[];
  function: Row;
}
interface Evidence {
  synthetic: true;
  clusterArn: string;
  database: string;
  timingMethod: string;
  before: Snapshot;
  after?: Snapshot;
  cases: CaseResult[];
  allEqual?: boolean;
}

export function canonicalVectors(): CanonicalVector[] {
  const vectors: CanonicalVector[] = CANONICAL_CASES.map(
    ([input, expected], index) => ({
      id: `expected-${String(index + 1)}`,
      input,
      expected,
    }),
  );
  for (let code = 1; code <= 31; code++) {
    const input = JSON.stringify(`a${String.fromCharCode(code)}b`);
    vectors.push({
      id: `control-${code.toString(16).padStart(2, "0")}`,
      input,
      expected: input,
    });
  }
  for (const [input, expected] of [
    ["1.50", '"1.5"'],
    ["-0.0", '"0"'],
    ["1e3", '"1000"'],
    ["0.000100", '"0.0001"'],
    ["true", "true"],
    ["false", "false"],
    ["null", "null"],
    ["{}", "{}"],
    ["[]", "[]"],
  ] as const)
    vectors.push({ id: `scalar-${input}`, input, expected });
  const strings = [
    ["empty", ""],
    ["plain", "SP2 synthetic string"],
    ["quote", '"'],
    ["backslash", "\\"],
    ["arabic", "عقارك شركة تجريبية"],
    ["emoji", "🏠😀"],
    [
      "all-controls",
      Array.from({ length: 31 }, (_, i) => String.fromCharCode(i + 1)).join(""),
    ],
    ["mixed-escapes", '\\n\\u0001"\n\u0001\\\tعقارك😀'],
    ["unicode-unmodified", "é e\u0301 / \u007f \u0085 \u2028 \u2029"],
    ["long-47000", "x".repeat(47_000)],
  ] as const;
  for (const [id, value] of strings) {
    const input = JSON.stringify(value);
    vectors.push({ id, input, expected: input });
  }
  vectors.push(
    {
      id: "nested",
      input:
        '{"z":[null,false,1.50,{"عقارك":"😀","a":[-0.0,1e3,0.000100]}],"a":{}}',
      expected:
        '{"a":{},"z":[null,false,"1.5",{"a":["0","1000","0.0001"],"عقارك":"😀"}]}',
    },
    {
      id: "escaped-keys",
      input: String.raw`{"\u0001":"\\","\"":"\t","a":2.0}`,
      expected: String.raw`{"\u0001":"\\","\"":"\t","a":"2"}`,
    },
    {
      id: "byte-order",
      input: '{"😀":1,"ع":2,"é":3,"a":4,"Z":5}',
      expected: '{"Z":"5","a":"4","é":"3","ع":"2","😀":"1"}',
    },
  );
  return vectors;
}

// Materialized dependencies keep immutable evaluation between the two server clocks.
export const TIMED_CANONICAL_SQL = `with input as materialized (
  select cast(:value as jsonb) as value
), started as materialized (
  select value, clock_timestamp() as started_at from input
), canonical as materialized (
  select audit.canonical_text(value) as canonical, started_at from started
), finished as materialized (
  select canonical, started_at, clock_timestamp() as finished_at from canonical
)
select canonical, (extract(epoch from (finished_at - started_at)) * 1000)::text as server_ms from finished`;

export async function observeCanonical(
  executor: DataApiExecutor,
  vector: CanonicalVector,
): Promise<Observation> {
  const result = await executor.execute(TIMED_CANONICAL_SQL, [
    { name: "value", value: vector.input, typeHint: "JSON" },
  ]);
  const row = result.rows[0];
  assert.equal(
    typeof row?.canonical,
    "string",
    `Missing canonical result: ${vector.id}`,
  );
  assert.equal(
    typeof row?.server_ms,
    "string",
    `Missing server duration: ${vector.id}`,
  );
  const canonical = String(row?.canonical);
  const serverMs = Number(row?.server_ms);
  assert.ok(
    Number.isFinite(serverMs) && serverMs >= 0,
    `Invalid duration: ${vector.id}`,
  );
  if (vector.expected !== undefined)
    assert.equal(
      canonical,
      vector.expected,
      `Expected vector failed: ${vector.id}`,
    );
  return {
    canonical,
    serverMs,
    utf8Sha256: createHash("sha256").update(canonical, "utf8").digest("hex"),
  };
}

export function assertEquivalent(
  before: Observation,
  after: Observation,
  id: string,
): void {
  assert.ok(
    Buffer.from(before.canonical, "utf8").equals(
      Buffer.from(after.canonical, "utf8"),
    ),
    `Canonical bytes differ: ${id}`,
  );
  assert.equal(
    before.utf8Sha256,
    after.utf8Sha256,
    `Canonical digest differs: ${id}`,
  );
}

async function snapshot(
  executor: DataApiExecutor,
  phase: "before" | "after",
): Promise<Snapshot> {
  const migrations = await loadMigrations(
    fileURLToPath(new URL("../migrations", import.meta.url)),
  );
  const expected = migrations
    .filter(
      (file) =>
        phase === "after" || file.name !== "0003_linear_canonical_text.sql",
    )
    .map(({ name, sha256 }) => ({ name, sha256 }));
  const ledger = (
    await executor.execute(
      "select name, sha256 from ops.schema_migration order by name",
    )
  ).rows;
  assert.deepEqual(ledger, expected, `Unexpected ${phase} migration ledger`);
  const metadata = (
    await executor.execute(`select p.provolatile::text as volatility, p.proisstrict as strict,
    p.proconfig::text as settings, pg_get_userbyid(p.proowner) as owner,
    encode(sha256(convert_to(pg_get_functiondef(p.oid), 'UTF8')), 'hex') as definition_sha256
    from pg_proc p where p.oid = 'audit.canonical_text(jsonb)'::regprocedure`)
  ).rows[0];
  assert.ok(metadata, "Canonical function missing");
  assert.equal(metadata.volatility, "i");
  assert.equal(metadata.strict, true);
  assert.equal(metadata.settings, '{"search_path=pg_catalog, pg_temp"}');
  assert.equal(metadata.owner, "postgres");
  return { capturedAt: new Date().toISOString(), ledger, function: metadata };
}

async function main(): Promise<void> {
  const phase = process.argv.splice(2, 1)[0];
  assert.ok(
    phase === "before" || phase === "after",
    "First argument must be before or after",
  );
  const options = localOptions();
  const out =
    options.out ||
    fileURLToPath(
      new URL(
        "../spikes/results/canonical-equivalence-2026-09-28.json",
        import.meta.url,
      ),
    );
  const executor = localExecutor(options, options.masterSecretArn);
  const vectors = canonicalVectors();
  assert.ok(vectors.length >= 40);
  if (phase === "before") {
    const before = await snapshot(executor, phase);
    const cases: CaseResult[] = [];
    for (const vector of vectors)
      cases.push({
        ...vector,
        before: await observeCanonical(executor, vector),
      });
    const evidence: Evidence = {
      synthetic: true,
      clusterArn: options.clusterArn,
      database: options.database,
      timingMethod:
        "Server clock_timestamp differences within one statement; materialized input and canonical result; one observation per case, not a latency distribution.",
      before,
      cases,
    };
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, `${JSON.stringify(evidence, null, 2)}\n`, {
      flag: "wx",
    });
    process.stdout.write(
      `Saved ${String(cases.length)} baseline cases; long string server duration ${String(cases.find((row) => row.id === "long-47000")?.before.serverMs)} ms\n`,
    );
  } else {
    const evidence = JSON.parse(await readFile(out, "utf8")) as Evidence;
    assert.equal(evidence.clusterArn, options.clusterArn);
    assert.equal(evidence.database, options.database);
    assert.equal(
      evidence.after,
      undefined,
      "Completed evidence cannot be overwritten",
    );
    assert.deepEqual(
      evidence.cases.map(({ id, input, expected }) => ({
        id,
        input,
        expected,
      })),
      vectors,
    );
    const after = await snapshot(executor, phase);
    for (const row of evidence.cases) {
      row.after = await observeCanonical(executor, row);
      assertEquivalent(row.before, row.after, row.id);
      row.equal = true;
    }
    evidence.after = after;
    evidence.allEqual = true;
    await writeFile(out, `${JSON.stringify(evidence, null, 2)}\n`);
    const long = evidence.cases.find((row) => row.id === "long-47000");
    process.stdout.write(
      `Verified ${String(evidence.cases.length)} byte-identical cases\n47,000-character server duration: before ${String(long?.before.serverMs)} ms; after ${String(long?.after?.serverMs)} ms\n`,
    );
  }
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Canonical equivalence failed"}\n`,
    );
    process.exitCode = 1;
  }
}
