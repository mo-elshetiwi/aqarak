import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createBudgetGuard, loadModelRegistry } from "@aqarak/api/models";
import { loadConfig } from "../config";
import { runScreening } from "../screening";
import { createScreeningRuntime } from "../runtime";
import { parseScreenArguments, SCREEN_HELP } from "./arguments";

async function main(): Promise<void> {
  const args = parseScreenArguments(process.argv.slice(2));
  if (args === null) {
    process.stdout.write(SCREEN_HELP);
    return;
  }
  const config = loadConfig();
  const registry = loadModelRegistry();
  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const { stdout } = await promisify(execFile)("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
  });
  const budget = createBudgetGuard({ [args.class]: args["cap-usd"] });
  const runtime = createScreeningRuntime({
    config,
    registry,
    classId: args.class,
    candidateIds: args.candidates,
    budget,
    now: () => new Date(),
  });
  const controller = new AbortController();
  const interrupt = (): void => {
    controller.abort();
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    await runScreening({
      classId: args.class,
      candidateIds: args.candidates,
      runId: args["run-id"],
      split: args.split,
      registry,
      gateway: runtime.gateway,
      repositoryRoot,
      resultsDir: join(repositoryRoot, "evaluation/results"),
      syntheticDir: join(
        repositoryRoot,
        "evaluation/datasets/synthetic-docs-v1",
      ),
      dataDir: config.AQARAK_DATA_DIR,
      privateRunsDir: config.AQARAK_PRIVATE_RUNS_DIR,
      gitSha: stdout.trim(),
      command: `pnpm --filter @aqarak/evaluation screen -- ${process.argv
        .slice(2)
        .filter((argument) => argument !== "--")
        .join(" ")}`,
      now: () => new Date(),
      ...(args.limit === undefined ? {} : { limit: args.limit }),
      concurrency: args.concurrency,
      resume: args.resume,
      signal: controller.signal,
      budget,
      beforeCandidate: runtime.beforeCandidate,
      progress: (line) => {
        process.stdout.write(`${line}\n`);
      },
    });
  } finally {
    runtime.close();
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    error instanceof Error
      ? `${error.name}: ${error.message}\n`
      : "Error: Unknown screening failure\n",
  );
  process.exitCode = 1;
});
