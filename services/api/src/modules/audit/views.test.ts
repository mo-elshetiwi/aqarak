import { describe, expect, it } from "vitest";
import { csvCell, encodeCsv } from "./csv";
import { parseFilters, versionDiff } from "./views";

describe("trail filters", () => {
  it.each(["0", "101", "1.5", "invalid"])("rejects limit %s", (limit) => {
    expect(() => parseFilters({ limit: [limit] })).toThrow();
  });
  it("rejects unknown and repeated query keys", () => {
    expect(() => parseFilters({ unknown: ["value"] })).toThrow();
    expect(() => parseFilters({ limit: ["1", "2"] })).toThrow();
    expect(() => parseFilters({ refusalsOnly: ["yes"] })).toThrow();
  });
  it("supports distinct JSON and CSV defaults and bounds", () => {
    expect(parseFilters({}).limit).toBe(50);
    expect(parseFilters({}, true).limit).toBe(5000);
    expect(parseFilters({ limit: ["100"] }).limit).toBe(100);
    expect(() => parseFilters({ limit: ["5001"] }, true)).toThrow();
  });
});
describe("CSV encoding", () => {
  it.each(["=1+1", "+cmd", "-cmd", "@cmd", "\tcmd", "\rcmd"])(
    "guards %j",
    (input) => {
      expect(csvCell(input).replace(/^"/, "").startsWith("'")).toBe(true);
    },
  );
  it("quotes commas, quotes and newlines and preserves Arabic and the BOM", () => {
    expect(csvCell('عقار,"سطر"\n')).toBe('"عقار,""سطر""\n"');
    expect(csvCell(null)).toBe("");
    const body = encodeCsv([]);
    expect([...Buffer.from(body).subarray(0, 3)]).toEqual([239, 187, 191]);
    expect(Buffer.from(csvCell("عقار")).toString("utf8")).toBe("عقار");
    expect(body).toContain("seq,occurred_at,event_type");
    expect(body.endsWith("\r\n")).toBe(true);
  });
});
describe("version diff", () => {
  it("retains type changes that canonical request hashing intentionally normalizes", () => {
    expect(versionDiff({ value: 1 }, { value: "1" })).toEqual([
      { field: "value", before: 1, after: "1" },
    ]);
  });
  it("lists initial non-null business fields and ignores metadata", () => {
    expect(
      versionDiff(null, {
        workflow_state: "awaiting_registration",
        reason: null,
        version: 1,
        created_at: "now",
        search_norm: "x",
      }),
    ).toEqual([
      { field: "workflow_state", before: null, after: "awaiting_registration" },
    ]);
  });
  it("reports changed, removed and added fields without object-key-order noise", () => {
    expect(
      versionDiff(
        {
          workflow_state: "awaiting_registration",
          removed: true,
          json: { a: 1, b: 2 },
          version: 1,
        },
        {
          workflow_state: "under_review",
          added: "x",
          json: { b: 2, a: 1 },
          version: 2,
        },
      ),
    ).toEqual([
      { field: "added", before: null, after: "x" },
      { field: "removed", before: true, after: null },
      {
        field: "workflow_state",
        before: "awaiting_registration",
        after: "under_review",
      },
    ]);
  });
});
