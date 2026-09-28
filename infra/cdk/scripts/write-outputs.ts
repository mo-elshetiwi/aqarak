import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { getEnvironmentConfig } from "../src/config";
import { mapDevOutputs, serialiseOutputs } from "../src/outputs";

const packageDirectory = resolve(import.meta.dirname, "..");
const input: unknown = JSON.parse(
  await readFile(resolve(packageDirectory, "cdk.out/dev-outputs.json"), "utf8"),
);
const { values } = parseArgs({
  options: { context: { type: "string", short: "c", multiple: true } },
});
const configuration = z
  .object({ context: z.record(z.string(), z.unknown()) })
  .parse(
    JSON.parse(await readFile(resolve(packageDirectory, "cdk.json"), "utf8")),
  );
const context = { ...configuration.context };
for (const entry of values.context ?? []) {
  const separator = entry.indexOf("=");
  if (separator < 1) throw new Error("Context must use key=value");
  context[entry.slice(0, separator)] = entry.slice(separator + 1);
}
const outputs = mapDevOutputs(
  input,
  getEnvironmentConfig("dev", context).account,
);
await mkdir(resolve(packageDirectory, "outputs"), { recursive: true });
await writeFile(
  resolve(packageDirectory, "outputs/dev.json"),
  serialiseOutputs(outputs),
  "utf8",
);
process.stdout.write(
  "Wrote validated development application outputs to outputs/dev.json\n",
);
