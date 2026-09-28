import { fileURLToPath } from "node:url";
import { loadMigrations, runMigrations } from "../src/migrate.ts";
import { localExecutor, localOptions } from "./cli.ts";

try {
  const options = localOptions();
  const result = await runMigrations(
    localExecutor(options, options.masterSecretArn),
    await loadMigrations(
      fileURLToPath(new URL("../migrations", import.meta.url)),
    ),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Migration failed"}\n`,
  );
  process.exitCode = 1;
}
