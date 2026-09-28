import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const cli = fileURLToPath(new URL("./screen.ts", import.meta.url));
const execute = promisify(execFile);

it(
  "reports the error class and message and exits one without echoing rejected arguments",
  { timeout: 30_000 },
  async () => {
    await expect(
      execute(
        process.execPath,
        ["--import", "tsx", cli, "--unknown", "private-fixture-value"],
        { timeout: 20_000 },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stdout: "",
      stderr: "Error: Invalid screening arguments\n",
    });
  },
);

it(
  "prints English help and exits successfully without loading configuration",
  { timeout: 30_000 },
  async () => {
    const { stdout, stderr } = await execute(
      process.execPath,
      ["--import", "tsx", cli, "--help"],
      { timeout: 20_000 },
    );
    expect(stdout).toContain("Collect screening receipts");
    expect(stdout).not.toMatch(/[\u0600-\u06ff]/u);
    expect(stderr).toBe("");
  },
);

it(
  "preserves a specific error class without creating a provider runtime",
  { timeout: 30_000 },
  async () => {
    await expect(
      execute(
        process.execPath,
        [
          "--import",
          "tsx",
          cli,
          "--class",
          "mc1_document_extraction",
          "--split",
          "screening",
          "--candidates",
          "missing-fixture-candidate",
          "--run-id",
          "fixture",
          "--cap-usd",
          "0",
        ],
        {
          timeout: 20_000,
          env: { PATH: "/usr/bin:/bin", AQARAK_DATA_DIR: "fixture-data" },
        },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stdout: "",
      stderr: "UnknownCandidateError: Unknown candidate\n",
    });
  },
);
