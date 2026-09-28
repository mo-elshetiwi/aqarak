import { describe, expect, it } from "vitest";
import {
  assessDataApiRecords,
  assessHealth,
  assessStacks,
  developmentStackNames,
  parseTemplateDiff,
} from "./smoke";

const row = {
  db_user: "aqarak_app",
  visible_companies: 0,
  time_zone: "UTC",
  engine_version: "17.9",
};
const stacks = developmentStackNames.map((StackName) => ({
  StackName,
  StackStatus: "CREATE_COMPLETE",
  CreationTime: "2026-09-28T00:00:00Z",
}));
const cleanDiff = developmentStackNames
  .map(
    (name) => `Stack Dev/${name.slice(4)} (${name})\nThere were no differences`,
  )
  .join("\n");

describe("health assessment", () => {
  it("accepts only the exact successful JSON response", () => {
    expect(assessHealth(200, '{"status":"ok"}').passed).toBe(true);
  });
  it.each([
    [500, '{"status":"ok"}'],
    [200, '{"status":"error"}'],
    [200, "not JSON"],
    [200, '{"status":"ok","extra":true}'],
    [200, "null"],
  ])("rejects status %s with body %s", (status, body) => {
    expect(assessHealth(status, body).passed).toBe(false);
  });
  it("does not retain an unexpected response body", () => {
    expect(
      assessHealth(200, '{"unexpected":"private content"}').evidence,
    ).toEqual({ status: 200, body: null });
  });
});

describe("database assessment", () => {
  it("accepts the isolated application runtime role on PostgreSQL 17", () => {
    expect(assessDataApiRecords([row])).toEqual({
      passed: true,
      evidence: row,
    });
  });
  it.each([
    { db_user: "postgres" },
    { visible_companies: 1 },
    { time_zone: "Europe/London" },
    { engine_version: "16.9" },
    { engine_version: "170.1" },
  ])("rejects an unexpected runtime property %j", (change) => {
    expect(assessDataApiRecords([{ ...row, ...change }]).passed).toBe(false);
  });
  it.each(
    [
      [],
      [row, row],
      null,
      [{ ...row, visible_companies: "0" }],
      [{ ...row, extra: true }],
    ].map((records) => ({ records })),
  )("rejects invalid database records %j", ({ records }) => {
    expect(assessDataApiRecords(records).passed).toBe(false);
  });
});

describe("stack assessment", () => {
  it("accepts the eight complete development stacks and ignores other stages", () => {
    expect(
      assessStacks({
        Stacks: [...stacks, { ...stacks[0], StackName: "Other-Stack" }],
      }).passed,
    ).toBe(true);
    expect(
      assessStacks({
        Stacks: stacks.map((stack) => ({
          ...stack,
          StackStatus: "UPDATE_COMPLETE",
          LastUpdatedTime: "2026-09-28T01:00:00+00:00",
        })),
      }).passed,
    ).toBe(true);
  });
  it("records the update time or the initial creation time", () => {
    const result = assessStacks({ Stacks: stacks });
    expect(result.evidence).toEqual({
      stacks: stacks
        .map((stack) => ({
          name: stack.StackName,
          status: stack.StackStatus,
          lastUpdatedAt: stack.CreationTime,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  });
  it.each(
    [
      stacks.slice(1),
      [...stacks, { ...stacks[0], StackName: "Dev-ExtraStack" }],
      stacks.map((stack, index) =>
        index === 0
          ? { ...stack, StackStatus: "UPDATE_ROLLBACK_COMPLETE" }
          : stack,
      ),
      stacks.map((stack, index) => (index === 0 ? stacks[1] : stack)),
    ].map((input) => ({ input })),
  )("rejects missing, extra, rolled back or duplicated stacks", ({ input }) => {
    expect(assessStacks({ Stacks: input }).passed).toBe(false);
  });
  it("rejects malformed stack responses", () => {
    expect(assessStacks({ Stacks: [{}] }).passed).toBe(false);
  });
});

describe("template difference parsing", () => {
  it("extracts eight unchanged stacks and the omitted non-ASCII count", () => {
    const result = parseTemplateDiff(
      `Bundling asset example\n${cleanDiff}\nOmitted 1 changes because they are likely mangled non-ASCII characters. Use --strict to print them.\n✨  Number of stacks with differences: 0\nNOTICES\nUnrelated text`,
    );
    expect(result.passed).toBe(true);
    expect(result.evidence.stacks).toHaveLength(8);
    expect(
      result.evidence.stacks.every(
        (stack) => stack.status === "no-differences",
      ),
    ).toBe(true);
    expect(result.evidence.stacksWithDifferences).toBe(0);
    expect(result.evidence.omittedNonAsciiChanges).toBe(1);
  });
  it("names a stack with a resource change", () => {
    const changed = cleanDiff.replace(
      "Stack Dev/ApiStack (Dev-ApiStack)\nThere were no differences",
      "Stack Dev/ApiStack (Dev-ApiStack)\nResources\n[~] AWS::Lambda::Function ApiFunction\n └─ [~] Timeout\n     ├─ [-] 20\n     └─ [+] 30",
    );
    const result = parseTemplateDiff(
      `${changed}\nNumber of stacks with differences: 1`,
    );
    expect(result.passed).toBe(false);
    expect(
      result.evidence.stacks.filter((stack) => stack.status === "differences"),
    ).toEqual([{ name: "Dev-ApiStack", status: "differences" }]);
    expect(result.evidence.stacksWithDifferences).toBe(1);
  });
  it("handles physical names, colour sequences and repeated omitted notices", () => {
    const result = parseTemplateDiff(
      `${cleanDiff.replaceAll(/Stack Dev\/([A-Za-z]+)/gu, "Stack \u001b[1mDev-$1\u001b[0m")}\nOmitted 1 changes because they are likely mangled non-ASCII characters.\nOmitted 2 changes because they are likely mangled non-ASCII characters.\nNumber of stacks with differences: 0`,
    );
    expect(result.passed).toBe(true);
    expect(result.evidence.omittedNonAsciiChanges).toBe(3);
  });
  it.each([
    "",
    "Unrelated lines\nNumber of stacks with differences: 0",
    cleanDiff,
    `${cleanDiff}\nNumber of stacks with differences: 1`,
    `${cleanDiff}\nStack Dev/ExtraStack\nThere were no differences\nNumber of stacks with differences: 0`,
    `${cleanDiff}\nNumber of stacks with differences: 0\nNumber of stacks with differences: 0`,
  ])("fails closed for incomplete or inconsistent output", (text) => {
    expect(parseTemplateDiff(text).passed).toBe(false);
  });
});
