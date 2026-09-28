import { writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { sha256Hex } from "@aqarak/domain";
import type { DataApiExecutor } from "@aqarak/db/data-api";
import { kernelDependenciesFromEnvironment } from "../../audit/kernel";
import { seed, type Seed } from "../test-support/seed";
export interface SmokeOptions {
  companyId?: string;
  sessionsOut: string;
  stage: string | undefined;
  databaseName: string | undefined;
}
export async function seedLocalSmoke(
  executor: DataApiExecutor,
  options: SmokeOptions,
): Promise<Seed> {
  if (
    options.stage !== "local" ||
    !options.databaseName?.startsWith("aqarak_") ||
    options.databaseName === "aqarak"
  )
    throw new Error("Local smoke seeding requires a local isolated database.");
  const target = resolve(options.sessionsOut);
  if (relative(process.cwd(), target).startsWith(".."))
    throw new Error(
      "The sessions file must remain within the working directory.",
    );
  const data = await seed(executor, {
    frozenOwnerGate: true,
    ...(options.companyId === undefined
      ? {}
      : { companyId: z.uuid().parse(options.companyId) }),
  });
  await writeFile(
    target,
    JSON.stringify({
      sessions: Object.entries(data.accounts).map(([role, accountId]) => ({
        accountId,
        sessionSha256: sha256Hex(
          data.sessions[role as keyof typeof data.sessions],
        ),
      })),
    }),
    { mode: 0o600, flag: "wx" },
  );
  return data;
}
export function parseSmokeArguments(args: string[]): {
  sessionsOut: string;
  companyId?: string;
} {
  const { values } = parseArgs({
    args,
    options: {
      "sessions-out": { type: "string" },
      "company-id": { type: "string" },
    },
  });
  const sessionsOut = values["sessions-out"];
  if (!sessionsOut) throw new Error("--sessions-out is required");
  const companyId = z.uuid().optional().parse(values["company-id"]);
  return { sessionsOut, ...(companyId === undefined ? {} : { companyId }) };
}
async function main(): Promise<void> {
  const { sessionsOut, companyId } = parseSmokeArguments(process.argv.slice(2));
  const deps = kernelDependenciesFromEnvironment(process.env);
  try {
    const result = await seedLocalSmoke(deps.database, {
      sessionsOut,
      stage: process.env.STAGE,
      databaseName: process.env.DATABASE_NAME,
      ...(companyId === undefined ? {} : { companyId }),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    deps.s3.destroy();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
