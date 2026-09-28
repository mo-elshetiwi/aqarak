import { stripVTControlCharacters } from "node:util";
import { z } from "zod";

export const developmentStackNames = [
  "Dev-FoundationStack",
  "Dev-NetworkStack",
  "Dev-DataStack",
  "Dev-DatabaseOpsStack",
  "Dev-IdentityStack",
  "Dev-StorageStack",
  "Dev-EmailStack",
  "Dev-ApiStack",
] as const;

export interface Assessment {
  passed: boolean;
  evidence: unknown;
}

/** Checks the exact public health response and excludes unexpected payloads. */
export function assessHealth(status: number, text: string): Assessment {
  let body: unknown = null;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return { passed: false, evidence: { status, body: null } };
  }
  const parsed = z.strictObject({ status: z.literal("ok") }).safeParse(body);
  return {
    passed: status === 200 && parsed.success,
    evidence: { status, body: parsed.success ? parsed.data : null },
  };
}

/** Checks the runtime role, unscoped isolation, timezone and engine version. */
export function assessDataApiRecords(records: unknown): Assessment {
  const parsed = z
    .array(
      z.strictObject({
        db_user: z.string().regex(/^[a-z_]+$/u),
        visible_companies: z.number().int().nonnegative(),
        time_zone: z.string().regex(/^[A-Za-z_+/0-9-]+$/u),
        engine_version: z.string().regex(/^\d+(?:\.\d+)*$/u),
      }),
    )
    .length(1)
    .safeParse(records);
  const row = parsed.success ? parsed.data[0] : undefined;
  return {
    passed:
      row?.db_user === "aqarak_app" &&
      row.visible_companies === 0 &&
      row.time_zone === "UTC" &&
      row.engine_version.startsWith("17."),
    evidence: row ?? { error: "Invalid database response" },
  };
}

/** Checks that precisely the expected development stacks completed successfully. */
export function assessStacks(response: unknown): Assessment {
  const parsed = z
    .object({
      Stacks: z.array(
        z.object({
          StackName: z.string().regex(/^[A-Za-z][A-Za-z0-9-]*$/u),
          StackStatus: z.string().regex(/^[A-Z_]+$/u),
          LastUpdatedTime: z.iso.datetime({ offset: true }).optional(),
          CreationTime: z.iso.datetime({ offset: true }),
        }),
      ),
    })
    .safeParse(response);
  if (!parsed.success)
    return { passed: false, evidence: { error: "Invalid stack response" } };
  const stacks = parsed.data.Stacks.filter((stack) =>
    stack.StackName.startsWith("Dev-"),
  )
    .map((stack) => ({
      name: stack.StackName,
      status: stack.StackStatus,
      lastUpdatedAt: stack.LastUpdatedTime ?? stack.CreationTime,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    passed:
      stacks.length === developmentStackNames.length &&
      developmentStackNames.every((name) =>
        stacks.some((stack) => stack.name === name),
      ) &&
      stacks.every((stack) =>
        ["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(stack.status),
      ),
    evidence: { stacks },
  };
}

interface StackDiff {
  name: string;
  status: "no-differences" | "differences";
}

export interface TemplateDiffAssessment extends Assessment {
  evidence: {
    stacks: StackDiff[];
    stacksWithDifferences: number | null;
    omittedNonAsciiChanges: number;
  };
}

/** Extracts stack outcomes and summary counts while ignoring diagnostic lines. */
export function parseTemplateDiff(text: string): TemplateDiffAssessment {
  const stacks: StackDiff[] = [];
  let current: StackDiff | undefined;
  let stacksWithDifferences: number | null = null;
  let omittedNonAsciiChanges = 0;
  let summaries = 0;
  for (const raw of text.split(/\r?\n/u)) {
    const line = stripVTControlCharacters(raw).trim();
    const header = /^Stack (?:Dev\/|Dev-)([A-Za-z0-9-]+)(?:\s|$)/u.exec(line);
    if (header?.[1]) {
      current = { name: `Dev-${header[1]}`, status: "differences" };
      stacks.push(current);
    }
    if (current && /^There were no differences(?:\s|$)/u.test(line))
      current.status = "no-differences";
    const summary =
      /^(?:✨\s*)?Number of stacks with differences: (\d+)$/u.exec(line);
    if (summary) {
      stacksWithDifferences = Number(summary[1]);
      summaries++;
    }
    const omitted =
      /^Omitted (\d+) changes? because they are likely mangled non-ASCII characters\./u.exec(
        line,
      );
    if (omitted) omittedNonAsciiChanges += Number(omitted[1]);
  }
  return {
    passed:
      summaries === 1 &&
      stacksWithDifferences === 0 &&
      stacks.length === developmentStackNames.length &&
      developmentStackNames.every((name) =>
        stacks.some((stack) => stack.name === name),
      ) &&
      stacks.every((stack) => stack.status === "no-differences"),
    evidence: {
      stacks: stacks.sort((a, b) => a.name.localeCompare(b.name)),
      stacksWithDifferences,
      omittedNonAsciiChanges,
    },
  };
}
