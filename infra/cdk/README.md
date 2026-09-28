# @aqarak/cdk

I keep the local CDK app with explicit development and production stages in this workspace.

Its public API consists of `AqarakStage` and `FoundationStack`.

I run `pnpm --filter @aqarak/cdk test` from the repository root to test this workspace. I run `pnpm synth` to produce local templates without deploying resources.

## Database operations

I deploy the stateless `DatabaseOpsStack` in each stage after the data stack. Its Node.js 24 ARM64 function runs outside the VPC, reads the four database secrets at runtime and uses the Data API. I copy the immutable SQL migration files into the deployment bundle; the handler uses `${LAMBDA_TASK_ROOT}/migrations` unless `MIGRATIONS_DIR` is set.

After every development deployment that changes migrations, I explicitly run `pnpm --filter @aqarak/cdk migrate:dev`. The command selects `MigrateFunctionName` from `cdk.out/dev-outputs.json`, invokes with `{"action":"migrate"}` using only `aqarak-dev` in `us-east-1`, prints the validated summary and fails on a function error. I expect a repeated invocation to skip the migration ledger entries. A CloudFormation migration trigger is a later change.

I invoke the same function with `{"action":"measure-latency"}` to measure complete audited write transactions and scoped read transactions in `us-east-1`. I discard two warm-up write/read pairs and retain 20 samples of each. I use the in-Region write p95 limit of 800 ms for the datastore decision; the local spike runner's network timings are diagnostic only. I keep operational function names out of the application output contract.

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

## Development smoke check

I run `pnpm --filter @aqarak/cdk smoke:dev` from a clean commit with an active `aqarak-dev` session. I verify the account before checking the exact public health response, the application database role with no visible company rows and the expected timezone and engine, all eight completed development stacks, and their deployed template differences. Every check is read-only: I use `cdk diff --method template` to avoid creating a change set and record the number of omitted non-ASCII changes separately. I synthesize into the deployment directory, `cdk.out`, because Lambda asset hashes include source-map paths relative to the synthesis directory. I preserve `cdk.out/dev-outputs.json` across the comparison. I interpret omitted text changes as unverified live text. I write the UTC-dated record to `infra/cdk/results/smoke-dev-YYYY-MM-DD.json`, including the source commit, initial working-tree state and each result; a failed check still writes evidence and exits non-zero.
