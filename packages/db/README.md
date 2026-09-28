# @aqarak/db

I keep the Data API transaction boundary, forward-only migrations, runtime role derivation and synthetic database checks in this workspace. I expose company and system transaction helpers from the package root, with administrative entry points in explicit subpaths.

I run `pnpm --filter @aqarak/db lint`, `pnpm --filter @aqarak/db typecheck`, `pnpm --filter @aqarak/db test` and `pnpm --filter @aqarak/db build` from the repository root.

I apply migrations with `pnpm --filter @aqarak/db migrate:dev` using `DATABASE_CLUSTER_ARN`, `DATABASE_NAME` and `MASTER_SECRET_ARN`, or the corresponding `--cluster-arn`, `--database` and `--master-secret-arn` arguments. The local command uses only the `aqarak-dev` profile in `us-east-1` and passes the secret ARN directly to the Data API. I bootstrap runtime roles only inside the migration worker.

I preserve applied files byte for byte and add later changes as numbered SQL files. I split each file at `--> statement-breakpoint` and execute its statements sequentially in one transaction, with its SHA-256 ledger entry committed in that transaction. I reject changed or missing applied files and overlapping migration runs. I checked the [Data API limitations](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.limitations.html) and [multi-statement restriction](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.troubleshooting.html#data-api.troubleshooting.multistatements): each statement requires a separate call, and transactional calls must remain less than three minutes apart.

I keep business access inside explicit transactions whose first statement installs transaction-local company and account context. I retain large document content in object storage and only its versioned pointer in database rows.

I run the synthetic gate with the development operator sequence below. I report live results separately from unit tests; unit tests alone do not establish isolation, audit or storage behaviour on the development cluster.

## Canonical text equivalence

I validate `0003_linear_canonical_text.sql` with `pnpm --filter @aqarak/db exec node --experimental-strip-types scripts/canonical-equivalence.ts before`, then `pnpm --filter @aqarak/db migrate:dev`, then the same equivalence command with `after`. I use the same development connection environment as the migration command. The script checks the ledger and function metadata, records all synthetic inputs and outputs in `spikes/results/canonical-equivalence-2026-09-28.json`, and asserts UTF-8 byte equality. It refuses to replace a baseline or a completed result. The `before` phase requires the ledger to precede `0003`; after application, the committed baseline is the historical evidence.

I retain the object, array, number, boolean and null branches unchanged. For strings, I return the original content between quotes when no escape is required. Otherwise I replace original backslashes first, then quotes, then the five short control escapes and the remaining control characters. Later replacements cannot match the printable characters introduced by an earlier replacement, so each input character receives exactly the original escape, with all other UTF-8 content preserved. The fixed set of scans and replacements is linear in string length; object-key sorting retains its existing cost. I use the [PostgreSQL string operations](https://www.postgresql.org/docs/current/functions-string.html) without Unicode normalization.

I measure each case with two server-side `clock_timestamp()` calls in one statement, using [materialized common table expressions](https://www.postgresql.org/docs/current/queries-with.html#QUERIES-WITH-CTE-MATERIALIZATION) to place canonical evaluation between the clocks. These observations measure server execution for the supplied cases, not a client latency distribution.

## Business schema

I add business tables in forward migrations beginning with `0005`. I register company rows for isolation, version stamps, snapshots and audit coverage. I use explicit read and write policies for `lease.contract_template` and `lease.clause`: standard rows have a null company and are readable by runtime roles, while only migrations can write them. Company reference rows retain versioning and snapshot coverage. I omit snapshots for migration-owned shared rows because they have no company audit chain.

I enforce submitted contract terms and their clause and occupant rows as immutable. I constrain each current version to its own contract, serialize child edits against submission, and reserve unit date ranges inclusively. I add references to maintenance tables when those tables are introduced in `0009`.

I keep idempotency keys, number counters and storage scan receipts outside business versioning because they are transaction and delivery bookkeeping. I explicitly protect these tables with row policies and narrow grants. Only the scheduler can delete idempotency rows older than seven days; scan receipts are append-only and pipeline-only. I retain versioning and snapshot coverage on the company outbox. I allocate numbers under a transactional row lock, so rollback restores the counter. Storage scan handlers use `ON CONFLICT DO NOTHING` with the four-column event identity.

I enforce conservation after allocation, refund, payment, instalment and charge changes. I lock affected payments in identifier order, then affected instalments and charges in identifier order, and include only active allocations from recorded payments in target balances. I count refunds in payment balances and leave instalment status transitions to commands. The command layer must retry transactions rejected for deadlock or serialization conflicts. I validate polymorphic invoice recipients against the selected party table in the same company.

I store completed model calls with `succeeded` or `failed` status. This is the provisional vocabulary because no model-call status catalogue is present in the domain package. I bound each extraction field to the keys `value`, `confidence`, `page` and `evidence`, with a serialized value of at most 2,000 characters, evidence of at most 2,000 characters, confidence between zero and one, and a positive integral page. I keep full page text and rendered documents in object storage. I register model calls and extractions as append-only and explicitly add insert snapshots; only the pipeline can insert these records.

I run `pnpm --filter @aqarak/db dom:dev` with the same development connection variables to exercise database invariants. Each check uses synthetic rows in a separate transaction and rolls the transaction back, including checks that deliberately fail. The numbering check forces five savepoint rollbacks before allocating consecutive values. I write the observed SQLSTATEs and rollback results to `spikes/results/domain-invariants-YYYY-MM-DD.json`. I distinguish these checks from a concurrent transaction stress test, which this script does not perform.

I give the two transaction-context results distinct column names because the Data API rejects duplicate names when returning JSON. The live invariant runner uses the same context statement as the runtime transaction helper. My observed results are recorded in `spikes/results/domain-invariants-2026-09-28.json`, the live table and migration ledger inspection in `spikes/results/business-catalogue-2026-09-28.json`, and command output in `spikes/results/business-schema-commands-2026-09-28.json`. The command record retains failed diagnostic runs as well as the subsequent successful checks.

## Development operator sequence

I run the following sequence from the repository root with an active `aqarak-dev` session. I use the deployed output files to obtain resource identifiers and secret ARNs. I keep each new run in a dated evidence directory so that earlier measurements remain available.

```sh
export AWS_PROFILE=aqarak-dev
export AWS_REGION=us-east-1

pnpm --filter @aqarak/cdk deploy:dev
pnpm --filter @aqarak/cdk migrate:dev
pnpm --filter @aqarak/cdk migrate:dev
pnpm --filter @aqarak/cdk outputs:dev
git diff --exit-code infra/cdk/outputs/dev.json

export DATABASE_CLUSTER_ARN="$(jq -r '.clusterArn' infra/cdk/outputs/dev.json)"
export DATABASE_NAME="$(jq -r '.databaseName' infra/cdk/outputs/dev.json)"
export APP_SECRET_ARN="$(jq -r '.appSecretArn' infra/cdk/outputs/dev.json)"
export MASTER_SECRET_ARN="$(jq -r '.["Dev-DataStack"].MasterSecretArn' infra/cdk/cdk.out/dev-outputs.json)"
AQARAK_DOCUMENTS_BUCKET="$(jq -r '.documentsBucketName' infra/cdk/outputs/dev.json)"
AQARAK_DATABASE_FUNCTION="$(jq -r '.["Dev-DatabaseOpsStack"].MigrateFunctionName' infra/cdk/cdk.out/dev-outputs.json)"
export AQARAK_EVIDENCE_DIR="$PWD/infra/cdk/test-results/$(date +%Y-%m-%d-%H%M%S)"
mkdir -p "$AQARAK_EVIDENCE_DIR"

pnpm --filter @aqarak/db sp2:dev -- \
  --cluster-arn "$DATABASE_CLUSTER_ARN" \
  --app-secret-arn "$APP_SECRET_ARN" \
  --master-secret-arn "$MASTER_SECRET_ARN" \
  --database "$DATABASE_NAME" --bucket "$AQARAK_DOCUMENTS_BUCKET" \
  --profile aqarak-dev --region us-east-1 \
  --out "$AQARAK_EVIDENCE_DIR/sp2-local.json"

aws lambda invoke --function-name "$AQARAK_DATABASE_FUNCTION" \
  --payload '{"action":"measure-latency"}' \
  --profile aqarak-dev --region us-east-1 \
  --cli-binary-format raw-in-base64-out --cli-read-timeout 310 --output json \
  "$AQARAK_EVIDENCE_DIR/sp2-in-region.json" \
  > "$AQARAK_EVIDENCE_DIR/sp2-invoke.json"

node --input-type=module <<'JS'
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
const directory = process.env.AQARAK_EVIDENCE_DIR;
const read = (name) => JSON.parse(readFileSync(`${directory}/${name}`, "utf8"));
const local = read("sp2-local.json");
const invocation = read("sp2-invoke.json");
const regional = read("sp2-in-region.json");
assert.equal(invocation.StatusCode, 200);
assert.equal(invocation.FunctionError, undefined);
assert.equal(regional.action, "measure-latency");
assert.deepEqual(local.checks.map((check) => check.id), ["ISO-05", "AUD-01", "PAR-01", "LRG-01", "LAT-01", "AUD-CHAIN"]);
assert.equal(local.passed, true);
assert(local.checks.every((check) => check.passed === true));
const latency = regional.latency;
assert.equal(latency.location, "Lambda client in us-east-1");
assert.equal(latency.warmups, 2);
assert.equal(latency.samples, 20);
for (const kind of ["write", "read"]) {
  const samples = latency[kind].samplesMs;
  assert.equal(samples.length, 20);
  assert(samples.every((sample) => Number.isFinite(sample) && sample >= 0));
  const ordered = [...samples].sort((a, b) => a - b);
  assert.equal(latency[kind].p50Ms, ordered[9]);
  assert.equal(latency[kind].p95Ms, ordered[18]);
}
assert(latency.write.p95Ms <= 800);
const decision = { passed: true, writeP95LimitMs: 800, latency };
writeFileSync(`${directory}/sp2-decision.json`, `${JSON.stringify(decision, null, 2)}\n`);
console.log(JSON.stringify(decision, null, 2));
JS

pnpm --filter @aqarak/db dom:dev -- \
  --profile aqarak-dev --region us-east-1 \
  --out "$AQARAK_EVIDENCE_DIR/domain.json"
pnpm --filter @aqarak/db catalogue:dev -- \
  --profile aqarak-dev --region us-east-1 \
  --out "$AQARAK_EVIDENCE_DIR/catalogue.json"
```

I expect both migration invocations to bootstrap the three runtime roles and skip every previously applied ledger entry. I require a successful local gate and the separate in-Region decision check before accepting the Data API path; I apply the 800 ms write p95 limit only to the in-Region measurement. I inspect each command's exit status and retain failed evidence as well as successful reruns.

I run domain checks with the master secret ARN and roll back their synthetic transactions. I run the catalogue check in a read-only, repeatable-read transaction with the same master secret ARN. It records every application table's row-security flags, policy names and predicates, version and entity-version triggers, and effective SELECT, INSERT, UPDATE, DELETE, TRUNCATE and REFERENCES privileges for the three runtime roles. It exits non-zero for missing application schemas, company tables without forced row security, unsafe or missing runtime roles, forbidden effective table privileges anywhere in the database, or a changed seven-day scheduler housekeeping DELETE policy. I interpret table-level UPDATE separately from column-level grants, such as the app role's `response` update on `ops.idempotency_key`.

I retain the spike's demo companies, document rows and versioned S3 object as evidence. I preserve the first-run file before recording a new dated result, copy measured values without rounding into ADR 0002, and keep local and in-Region measurements explicitly labelled.
