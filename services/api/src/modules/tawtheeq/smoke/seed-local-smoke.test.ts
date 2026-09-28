import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { parseSmokeArguments, seedLocalSmoke } from "./seed-local-smoke";

describe("local smoke seed configuration", () => {
  it("accepts a chosen company UUID and leaves the omitted ID random", () => {
    const companyId = randomUUID();
    expect(
      parseSmokeArguments([
        "--sessions-out",
        "dist/sessions.json",
        "--company-id",
        companyId,
      ]),
    ).toEqual({ sessionsOut: "dist/sessions.json", companyId });
    expect(
      parseSmokeArguments(["--sessions-out", "dist/sessions.json"]),
    ).toEqual({ sessionsOut: "dist/sessions.json" });
    expect(() =>
      parseSmokeArguments([
        "--sessions-out",
        "dist/sessions.json",
        "--company-id",
        "bad-id",
      ]),
    ).toThrow();
    expect(() => parseSmokeArguments(["--company-id", companyId])).toThrow(
      "--sessions-out is required",
    );
  });

  it.each([
    {
      stage: "production",
      databaseName: "aqarak_example",
      sessionsOut: "dist/sessions.json",
    },
    {
      stage: "local",
      databaseName: "aqarak",
      sessionsOut: "dist/sessions.json",
    },
    {
      stage: "local",
      databaseName: "other",
      sessionsOut: "dist/sessions.json",
    },
    {
      stage: "local",
      databaseName: "aqarak_example",
      sessionsOut: "../sessions.json",
    },
    {
      stage: "local",
      databaseName: "aqarak_example",
      sessionsOut: "dist/sessions.json",
      companyId: "bad-id",
    },
  ])(
    "refuses unsafe seed options before opening a transaction: $stage/$databaseName/$sessionsOut",
    async (options) => {
      const forbidden = vi.fn(() => {
        throw new Error("No database operation is permitted");
      });
      await expect(
        seedLocalSmoke(
          {
            begin: forbidden,
            execute: forbidden,
            commit: forbidden,
            rollback: forbidden,
          },
          options,
        ),
      ).rejects.toThrow();
      expect(forbidden).not.toHaveBeenCalled();
    },
  );
});
