import { execFileSync } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { z } from "zod";
import { developmentAccount, environmentOutputsSchema } from "../src/outputs";
import {
  assessDataApiRecords,
  assessHealth,
  assessStacks,
  parseTemplateDiff,
} from "../src/smoke";
import type { Assessment } from "../src/smoke";

const directory = resolve(import.meta.dirname, "..");
const root = resolve(directory, "../..");
const startedAt = new Date().toISOString();
const checks: ({ id: string } & Assessment)[] = [];
let commit: string | null = null;
let workingTreeClean = false;
let account: string | null = null;

function aws(args: string[], timeout = 30_000): unknown {
  return JSON.parse(
    execFileSync(
      "aws",
      [
        ...args,
        "--profile",
        "aqarak-dev",
        "--region",
        "us-east-1",
        "--output",
        "json",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout,
        env: { ...process.env, AWS_PAGER: "", AWS_MAX_ATTEMPTS: "1" },
      },
    ),
  ) as unknown;
}

async function check(
  id: string,
  action: () => Assessment | Promise<Assessment>,
): Promise<void> {
  try {
    checks.push({ id, ...(await action()) });
  } catch {
    checks.push({
      id,
      passed: false,
      evidence: { error: "Development smoke check failed" },
    });
  }
  process.stdout.write(`${id}: ${checks.at(-1)?.passed ? "PASS" : "FAIL"}\n`);
}

async function query(args: string[]): Promise<unknown> {
  const deadline = performance.now() + 60_000;
  let delay = 1000;
  for (;;) {
    try {
      const response = z
        .object({ formattedRecords: z.string() })
        .parse(
          aws(
            args,
            Math.max(
              1,
              Math.min(30_000, Math.floor(deadline - performance.now())),
            ),
          ),
        );
      return JSON.parse(response.formattedRecords) as unknown;
    } catch (error) {
      const parsed = z
        .object({ stderr: z.union([z.string(), z.instanceof(Buffer)]) })
        .safeParse(error);
      if (
        !parsed.success ||
        !parsed.data.stderr
          .toString()
          .includes("(DatabaseResumingException)") ||
        performance.now() + delay >= deadline
      )
        throw new Error("Database check failed");
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
      delay = Math.min(delay * 2, 8000);
    }
  }
}

function templateDiff(account: string): Assessment {
  const temporary = mkdtempSync(resolve(tmpdir(), "aqarak-smoke-"));
  const outputFile = resolve(temporary, "diff.txt");
  const deploymentOutputs = resolve(directory, "cdk.out/dev-outputs.json");
  const savedOutputs = resolve(temporary, "dev-outputs.json");
  const fd = openSync(outputFile, "w", 0o600);
  try {
    if (existsSync(deploymentOutputs))
      copyFileSync(deploymentOutputs, savedOutputs);
    // Lambda asset hashes include source-map paths relative to the synthesis directory, so the comparison uses the deployment directory.
    execFileSync(
      "pnpm",
      [
        "exec",
        "cdk",
        "diff",
        "Dev/*",
        "-c",
        `devAccount=${account}`,
        "--profile",
        "aqarak-dev",
        "--method",
        "template",
      ],
      {
        cwd: directory,
        stdio: ["ignore", fd, fd],
        timeout: 240_000,
        env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", AWS_PAGER: "" },
      },
    );
    return parseTemplateDiff(readFileSync(outputFile, "utf8"));
  } finally {
    closeSync(fd);
    try {
      if (
        existsSync(savedOutputs) &&
        (!existsSync(deploymentOutputs) ||
          !readFileSync(deploymentOutputs).equals(readFileSync(savedOutputs)))
      ) {
        mkdirSync(resolve(directory, "cdk.out"), { recursive: true });
        copyFileSync(savedOutputs, deploymentOutputs);
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return (value as unknown[]).map(sorted);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]: [string, unknown]) => [key, sorted(entry)]),
    );
  return value;
}

try {
  commit = z
    .string()
    .regex(/^[a-f0-9]{40}$/u)
    .parse(
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim(),
    );
  workingTreeClean =
    execFileSync("git", ["status", "--porcelain"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim() === "";
  const outputs = environmentOutputsSchema.parse(
    JSON.parse(
      readFileSync(resolve(directory, "outputs/dev.json"), "utf8"),
    ) as unknown,
  );
  account = developmentAccount(outputs);
  z.object({ Account: z.literal(account) }).parse(
    aws(["sts", "get-caller-identity"]),
  );
  await check("HEALTH", async () => {
    const start = performance.now();
    const response = await fetch(new URL("v1/health", outputs.apiUrl), {
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
    });
    const assessment = assessHealth(response.status, await response.text());
    const evidence = z
      .object({ status: z.number(), body: z.unknown() })
      .parse(assessment.evidence);
    return {
      passed: assessment.passed,
      evidence: {
        ...evidence,
        requestId: z
          .string()
          .regex(/^[a-zA-Z0-9-]+$/u)
          .nullable()
          .parse(response.headers.get("x-amzn-requestid")),
        elapsedMs: performance.now() - start,
      },
    };
  });
  await check("DATA-API", async () => {
    const start = performance.now();
    const records = await query([
      "rds-data",
      "execute-statement",
      "--resource-arn",
      outputs.clusterArn,
      "--secret-arn",
      outputs.appSecretArn,
      "--database",
      outputs.databaseName,
      "--format-records-as",
      "JSON",
      "--sql",
      "select current_user as db_user, (select count(*) from core.company) as visible_companies, current_setting('TimeZone') as time_zone, split_part(version(), ' ', 2) as engine_version",
    ]);
    const assessment = assessDataApiRecords(records);
    return {
      passed: assessment.passed,
      evidence: {
        ...z.record(z.string(), z.unknown()).parse(assessment.evidence),
        elapsedMs: performance.now() - start,
      },
    };
  });
  await check("STACKS", () =>
    assessStacks(aws(["cloudformation", "describe-stacks"])),
  );
  await check("TEMPLATE-DIFF", () => templateDiff(developmentAccount(outputs)));
} catch {
  checks.push({
    id: "PREFLIGHT",
    passed: false,
    evidence: { error: "Development smoke preflight failed" },
  });
} finally {
  const passed = checks.length === 4 && checks.every((entry) => entry.passed);
  const evidence = {
    stage: "dev",
    region: "us-east-1",
    account,
    commit,
    workingTreeClean,
    startedAt,
    completedAt: new Date().toISOString(),
    checks,
    passed,
  };
  mkdirSync(resolve(directory, "results"), { recursive: true });
  writeFileSync(
    resolve(directory, `results/smoke-dev-${startedAt.slice(0, 10)}.json`),
    `${JSON.stringify(sorted(evidence), null, 2)}\n`,
  );
  if (!passed) {
    process.stderr.write(
      "Development smoke check failed; inspect the recorded check results.\n",
    );
    process.exitCode = 1;
  }
}
