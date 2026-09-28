import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  migrationFunctionName,
  migrationSummary,
} from "../src/invoke-database";

try {
  const directory = resolve(import.meta.dirname, "../cdk.out");
  const outputs: unknown = JSON.parse(
    await readFile(resolve(directory, "dev-outputs.json"), "utf8"),
  );
  const responseFile = resolve(directory, "migrate-response.json");
  const metadata: unknown = JSON.parse(
    execFileSync(
      "aws",
      [
        "lambda",
        "invoke",
        "--function-name",
        migrationFunctionName(outputs),
        "--payload",
        JSON.stringify({ action: "migrate" }),
        "--profile",
        "aqarak-dev",
        "--region",
        "us-east-1",
        "--cli-binary-format",
        "raw-in-base64-out",
        "--cli-read-timeout",
        "310",
        "--output",
        "json",
        responseFile,
      ],
      { encoding: "utf8" },
    ),
  );
  const payload: unknown = JSON.parse(await readFile(responseFile, "utf8"));
  process.stdout.write(
    `${JSON.stringify(migrationSummary(metadata, payload), null, 2)}\n`,
  );
} catch {
  process.stderr.write(
    "Development migration invocation failed; inspect the database operations status and logs.\n",
  );
  process.exitCode = 1;
}
