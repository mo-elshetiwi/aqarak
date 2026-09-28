import { parseArgs } from "node:util";
import { z } from "zod";
import { safeIdSchema } from "../paths";

const argumentsSchema = z.strictObject({
  class: z.enum(["mc1_document_extraction", "mc3_speech_to_text"]),
  split: z.enum(["screening", "held_out"]),
  candidates: z
    .string()
    .transform((value) => value.split(","))
    .pipe(z.array(safeIdSchema).min(1)),
  "run-id": safeIdSchema,
  "cap-usd": z
    .string()
    .regex(/^\d+(?:\.\d{1,6})?$/)
    .transform((value) => {
      const [whole = "0", fraction = ""] = value.split(".");
      return Number(BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0")));
    })
    .pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)),
  limit: z.coerce.number().int().positive().optional(),
  concurrency: z.coerce.number().int().positive().default(4),
  resume: z.boolean().default(false),
});
export type ScreenArguments = z.infer<typeof argumentsSchema>;

export const SCREEN_HELP = `Collect screening receipts
Usage: pnpm --filter @aqarak/evaluation screen -- --class <class> --split <screening|held_out> --candidates <ids> --run-id <id> --cap-usd <n>
  --class          mc1_document_extraction | mc3_speech_to_text
  --candidates     Comma-separated registry candidate ids
  --run-id         Unique run id
  --cap-usd        Class spend cap in USD, up to six decimals
  --limit          Optional positive item count
  --concurrency    API workers, default 4; local workers always 1
  --resume         Skip successful receipts and restore spend
  --help           Show this help without loading configuration
`;

/** Parse a bounded screening command without including rejected arguments in errors. */
export function parseScreenArguments(
  argv: readonly string[],
): ScreenArguments | null {
  try {
    const { values } = parseArgs({
      args: [...(argv[0] === "--" ? argv.slice(1) : argv)],
      options: {
        class: { type: "string" },
        split: { type: "string" },
        candidates: { type: "string" },
        "run-id": { type: "string" },
        "cap-usd": { type: "string" },
        limit: { type: "string" },
        concurrency: { type: "string" },
        resume: { type: "boolean" },
        help: { type: "boolean" },
      },
      strict: true,
      allowPositionals: false,
    });
    if (values.help) return null;
    const parsed = argumentsSchema.safeParse(values);
    if (
      parsed.success &&
      new Set(parsed.data.candidates).size === parsed.data.candidates.length
    )
      return parsed.data;
  } catch {
    throw new Error("Invalid screening arguments");
  }
  throw new Error("Invalid screening arguments");
}
