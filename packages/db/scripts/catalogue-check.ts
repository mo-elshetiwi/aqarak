import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { inspectCatalogue } from "../src/spike/catalogue.ts";
import { localExecutor, localOptions } from "./cli.ts";

try {
  const startedAt = new Date().toISOString();
  const options = localOptions();
  const result = await inspectCatalogue(
    localExecutor(options, options.masterSecretArn),
  );
  const report = {
    gitCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    startedAt,
    completedAt: new Date().toISOString(),
    measurement: {
      client: "Local CLI via Data API",
      region: options.region,
      profile: "aqarak-dev",
      database: options.database,
    },
    ...result,
  };
  const output =
    options.out ||
    `spikes/results/catalogue-dev-${startedAt.slice(0, 10)}.json`;
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ passed: report.passed, tableCount: report.tableCount, companyTableCount: report.companyTableCount, assertions: report.assertions, output }, null, 2)}\n`,
  );
  if (!report.passed) process.exitCode = 1;
} catch {
  process.stderr.write("Development catalogue inspection failed.\n");
  process.exitCode = 1;
}
