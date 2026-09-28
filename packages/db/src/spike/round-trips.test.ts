import { expect, it, vi } from "vitest";
import type { Parameter, Row } from "../data-api.ts";
import { fakeExecutor } from "../test-helpers.ts";
import { checkRoundTrips } from "./round-trips.ts";

it.each([false, true])(
  "round trips the constrained policy object (JSON text: %s)",
  async (asText) => {
    const executor = fakeExecutor();
    let versionParams: readonly Parameter[] = [];
    let policy: unknown;
    vi.mocked(executor.execute).mockImplementation((sql, params = []) => {
      expect(sql).not.toMatch(/\bdetails\b/u);
      let rows: Row[] = [];
      if (sql === "show timezone") rows = [{ timezone: "UTC" }];
      if (sql.startsWith("insert into doc.document_version"))
        versionParams = params;
      if (
        sql.startsWith("insert into audit.audit_event") &&
        sql.includes("policy_decision")
      ) {
        const value = params.find(
          ({ name }) => name === "policy_decision",
        )?.value;
        expect(typeof value).toBe("string");
        policy = JSON.parse(String(value));
        expect(policy).toEqual({
          policy_version: "sp2",
          result: "allow",
          reasons: [
            "SP2 spike عقارك",
            { nested: [true, 7, null] },
            "control\u0001",
          ],
        });
      }
      if (sql.startsWith("select id::text as id, legal_name_en")) {
        rows = [
          {
            id: "company",
            legal_name_en: "SP2 spike synthetic company",
            is_demo: true,
            default_owner_gate: true,
          },
        ];
      }
      if (sql.startsWith("select id::text as id, version_no")) {
        const value = (name: string) =>
          versionParams.find((param) => param.name === name)?.value;
        rows = [
          {
            id: value("id"),
            version_no: "7",
            byte_size: value("size"),
            issue_date: value("issue"),
            expiry_date: value("expiry"),
            instant: "2026-01-02T03:04:05.123456Z",
            sha256: value("hash"),
            content_type: "text/plain",
          },
        ];
      }
      if (sql.startsWith("select policy_decision")) {
        rows = [{ policy_decision: asText ? JSON.stringify(policy) : policy }];
      }
      return Promise.resolve({ rows, numberOfRecordsUpdated: 0 });
    });
    await expect(checkRoundTrips(executor, "company")).resolves.toHaveProperty(
      "types",
      expect.arrayContaining(["jsonb"]),
    );
    expect(executor.commit).toHaveBeenCalledTimes(2);
  },
);
