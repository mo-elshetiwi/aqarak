import { z } from "zod";

const outputsSchema = z.record(z.string(), z.record(z.string(), z.string()));
const summarySchema = z.strictObject({
  action: z.literal("migrate"),
  roles: z.array(z.enum(["aqarak_app", "aqarak_pipeline", "aqarak_scheduler"])),
  migrations: z.strictObject({
    applied: z.array(z.string()),
    skipped: z.array(z.string()),
  }),
});

export function migrationFunctionName(raw: unknown): string {
  const stacks = outputsSchema.parse(raw);
  const names = Object.values(stacks).flatMap((outputs) =>
    outputs.MigrateFunctionName ? [outputs.MigrateFunctionName] : [],
  );
  if (names.length !== 1)
    throw new Error("Expected exactly one MigrateFunctionName output");
  return z
    .string()
    .regex(/^Dev-DatabaseOpsStack-[A-Za-z0-9-]+$/u)
    .parse(names[0]);
}

export function migrationSummary(
  metadata: unknown,
  payload: unknown,
): z.infer<typeof summarySchema> {
  const response = z
    .object({
      StatusCode: z.literal(200),
      FunctionError: z.string().optional(),
    })
    .parse(metadata);
  if (response.FunctionError)
    throw new Error("Database operations function returned an error");
  return summarySchema.parse(payload);
}
