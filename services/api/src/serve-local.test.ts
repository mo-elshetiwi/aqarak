import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { readLocalConfiguration } from "../scripts/serve-local";

function stopProcessGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if (!(
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    )) {
      throw error;
    }
  }
}

describe("local API configuration", () => {
  it("defaults to port 4000 without requiring cloud configuration", () => {
    expect(readLocalConfiguration({})).toEqual({
      port: 4000,
      setVariables: [],
    });
  });

  it.each(["", "65536", "-1", "1.5", "4e3", "invalid"])(
    "rejects invalid PORT %j",
    (PORT) => {
      expect(() => readLocalConfiguration({ PORT })).toThrow(
        "PORT must be an integer from 0 to 65535",
      );
    },
  );

  it("accepts port zero for an OS-assigned ephemeral listener", () => {
    expect(readLocalConfiguration({ PORT: "0" }).port).toBe(0);
  });

  it("reports configured variable names without their values", () => {
    const configuration = readLocalConfiguration({
      PORT: "4010",
      AWS_REGION: "synthetic-region",
      APP_SECRET_ARN: "synthetic-resource",
      DOCUMENTS_BUCKET_NAME: "synthetic-bucket",
      DATABASE_NAME: "",
      UNRELATED: "synthetic-unrelated",
    });
    expect(configuration).toEqual({
      port: 4010,
      setVariables: [
        "PORT",
        "AWS_REGION",
        "APP_SECRET_ARN",
        "DOCUMENTS_BUCKET_NAME",
      ],
    });
  });
});

it("serves health on an ephemeral port through dev:local and exits cleanly on SIGTERM", async () => {
  const child = spawn("pnpm", ["--filter", "@aqarak/api", "dev:local"], {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    env: {
      ...process.env,
      PORT: "0",
      STAGE: "local",
      APP_SECRET_ARN: "synthetic-do-not-log",
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let spawnError: Error | undefined;
  child.on("error", (error) => {
    spawnError = error;
  });
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    output += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    output += chunk;
  });
  try {
    await vi.waitFor(
      () => {
        expect(spawnError).toBeUndefined();
        expect(output).toMatch(/Local API listening on port [1-9][0-9]*;/u);
      },
      { timeout: 15000 },
    );
    const port = /Local API listening on port ([1-9][0-9]*);/u.exec(
      output,
    )?.[1];
    if (!port)
      throw new Error("The local API did not report its assigned port");
    const origin = `http://127.0.0.1:${port}`;
    expect(output).toContain("APP_SECRET_ARN");
    expect(output).not.toContain("synthetic-do-not-log");
    const response = execFileSync(
      "curl",
      [
        "--fail",
        "--silent",
        "--show-error",
        "--max-time",
        "5",
        "--write-out",
        "\n%{http_code}",
        `${origin}/v1/health`,
      ],
      { encoding: "utf8" },
    );
    expect(response).toBe('{"status":"ok"}\n200');
    const versionResponse = await fetch(`${origin}/v1/system/version`);
    expect(await versionResponse.json()).toMatchObject({
      stage: "local",
    });
    child.kill("SIGTERM");
    await vi.waitFor(
      () => {
        expect(child.exitCode).toBe(0);
      },
      { timeout: 10000 },
    );
    await expect(fetch(`${origin}/v1/health`)).rejects.toThrow();
  } finally {
    stopProcessGroup(child.pid);
  }
}, 30000);
