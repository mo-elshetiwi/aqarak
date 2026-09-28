import { readFile, writeFile, readdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { loadConfig } from "../config";
import { safeIdSchema } from "../paths";
import { readReceipts } from "../receipts";
import { loadSyntheticDocs, loadSplits } from "../datasets/synthetic-docs";
import { loadMixat } from "../datasets/mixat";
import { scoreRun } from "../score-run";

const argumentsSchema = z.strictObject({
  "run-id": safeIdSchema,
  class: z.enum(["mc1_document_extraction", "mc3_speech_to_text"]),
  candidates: z
    .string()
    .transform((value) => value.split(","))
    .pipe(z.array(safeIdSchema).min(1))
    .optional(),
  limitations: z.string().min(1).optional(),
});

export const SCORE_HELP = `Score screening receipts / تقييم إيصالات الفحص
Usage: pnpm --filter @aqarak/evaluation score -- --run-id <id> --class <class> [--candidates <ids>] [--limitations <file>]
  --run-id         Existing screening run id / معرّف الفحص
  --class          mc1_document_extraction | mc3_speech_to_text
  --candidates     Comma-separated ids; default: every folder with receipts / معرّفات مفصولة بفواصل
  --limitations    One limitation per line / قيد واحد لكل سطر
  --help           Show help without configuration / عرض المساعدة
`;

/** I validate scoring arguments before reading configuration or run files. */
export function parseScoreArguments(
  argv: readonly string[],
): z.infer<typeof argumentsSchema> | null {
  try {
    const { values } = parseArgs({
      args: [...(argv[0] === "--" ? argv.slice(1) : argv)],
      options: {
        "run-id": { type: "string" },
        class: { type: "string" },
        candidates: { type: "string" },
        limitations: { type: "string" },
        help: { type: "boolean" },
      },
      strict: true,
      allowPositionals: false,
    });
    if (values.help) return null;
    const parsed = argumentsSchema.safeParse(values);
    if (
      parsed.success &&
      (parsed.data.candidates === undefined ||
        new Set(parsed.data.candidates).size === parsed.data.candidates.length)
    )
      return parsed.data;
  } catch {
    throw new Error("Invalid scoring arguments / خيارات التقييم غير صالحة");
  }
  throw new Error("Invalid scoring arguments / خيارات التقييم غير صالحة");
}

async function main(): Promise<void> {
  const args = parseScoreArguments(process.argv.slice(2));
  if (args === null) {
    process.stdout.write(SCORE_HELP);
    return;
  }
  const config = loadConfig();
  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const files = await scoreRun({
    runId: args["run-id"],
    classId: args.class,
    ...(args.candidates === undefined ? {} : { candidateIds: args.candidates }),
    ...(args.limitations === undefined
      ? {}
      : { limitationsPath: args.limitations }),
    repositoryRoot,
    resultsDir: join(repositoryRoot, "evaluation/results"),
    syntheticDir: join(repositoryRoot, "evaluation/datasets/synthetic-docs-v1"),
    speechSplitsPath: join(
      repositoryRoot,
      "evaluation/datasets/speech-splits-v1.json",
    ),
    dataDir: config.AQARAK_DATA_DIR,
    privateRunsDir: config.AQARAK_PRIVATE_RUNS_DIR,
    io: {
      readBytes: readFile,
      writeText: (path, text) => writeFile(path, text, "utf8"),
      realpath,
      readReceipts,
      loadSyntheticDocs,
      loadSplits,
      loadMixat,
      async listCandidates(directory) {
        const candidates: string[] = [];
        for (const entry of await readdir(directory, { withFileTypes: true }))
          if (
            entry.isDirectory() &&
            (await readdir(join(directory, entry.name))).includes(
              "receipts.jsonl",
            )
          )
            candidates.push(entry.name);
        return candidates;
      },
    },
  });
  for (const file of files) process.stdout.write(`${file}\n`);
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error: unknown) => {
    process.stderr.write(
      error instanceof Error
        ? `${error.name}: ${error.message}\n`
        : "Error: Scoring failed / تعذّر التقييم\n",
    );
    process.exitCode = 1;
  });
