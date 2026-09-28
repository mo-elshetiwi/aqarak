import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadModelRegistry } from "./registry";

describe("bundled local model gateway", () => {
  it("serves a gateway call with the embedded registry and a stub provider", async () => {
    const root = resolve(import.meta.dirname, "../..");
    mkdirSync(resolve(root, "dist"), { recursive: true });
    const directory = mkdtempSync(resolve(root, "dist/registry-test-"));
    const bundle = resolve(directory, "server.mjs");
    const source = `
      import { app } from './src/app';
      import { startLocalServer } from './scripts/serve-local';
      import { loadModelRegistry } from './src/models/registry';
      import { createModelGateway } from './src/models/gateway';
      import { ZERO_USAGE } from './src/models/cost';
      import { fakeRequest } from './src/models/test-fixtures';
      const registry = loadModelRegistry();
      const gateway = createModelGateway({
        registry,
        structuredAdapters: { openai_responses: { generate: async () => ({
          text: JSON.stringify({ value: 'bundled registry resolved' }),
          usage: ZERO_USAGE, modelEcho: 'stub', finish: 'completed'
        }) } },
        transcriptionAdapters: {}, now: () => new Date()
      });
      app.get('/__registry-test', async (context) => {
        const result = await gateway.generateStructured({
          ...fakeRequest(), candidateId: registry.classes.mc1_document_extraction.primary
        });
        return context.json(result);
      });
      startLocalServer();
    `;
    try {
      execFileSync(
        "pnpm",
        [
          "exec",
          "esbuild",
          "--bundle",
          "--platform=node",
          "--format=esm",
          "--external:@aws-sdk/*",
          "--external:@hono/*",
          "--external:hono",
          "--external:zod",
          "--external:aws-jwt-verify",
          `--outfile=${bundle}`,
        ],
        { cwd: root, input: source, stdio: ["pipe", "pipe", "pipe"] },
      );
      const child = spawn(process.execPath, [bundle], {
        cwd: directory,
        env: {
          ...process.env,
          PORT: "0",
          STAGE: "local",
          IDENTITY_PROVIDER: "cognito",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      try {
        const origin = await new Promise<string>((accept, reject) => {
          const timer = setTimeout(() => {
            reject(new Error("Bundled server startup timed out"));
          }, 15000);
          let output = "";
          child.stdout.on("data", (chunk: Buffer) => {
            output += chunk.toString();
            const match = /Local API listening on port (\d+)/.exec(output);
            if (match?.[1]) {
              clearTimeout(timer);
              accept(`http://127.0.0.1:${match[1]}`);
            }
          });
          child.once("error", (error) => {
            clearTimeout(timer);
            reject(error);
          });
          child.once("exit", (code) => {
            clearTimeout(timer);
            reject(new Error(`Bundled server exited: ${String(code)}`));
          });
        });
        expect((await fetch(`${origin}/v1/health`)).status).toBe(200);
        const response = await fetch(`${origin}/__registry-test`);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          output: { value: "bundled registry resolved" },
          record: {
            status: "ok",
            candidateId:
              loadModelRegistry().classes.mc1_document_extraction.primary,
          },
        });
      } finally {
        if (child.exitCode === null) {
          const exited = once(child, "exit");
          child.kill("SIGTERM");
          await exited;
        }
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30000);
});
