import { expect, it, vi } from "vitest";
import { fakeExecutor } from "../test-helpers.ts";
import { checkNearLimitRow } from "./large-content.ts";

it.each(["intact", "truncated", "over-limit"])(
  "checks a near-limit Data API row: %s",
  async (mode) => {
    const executor = fakeExecutor();
    let title = "";
    vi.mocked(executor.execute).mockImplementation((sql, params = []) => {
      if (sql.startsWith("insert into doc.document"))
        title = String(params.find(({ name }) => name === "title")?.value);
      return Promise.resolve({
        rows: sql.startsWith("select title")
          ? [
              {
                title: mode === "truncated" ? title.slice(1) : title,
                row_bytes: mode === "over-limit" ? "49152" : "48600",
              },
            ]
          : [],
        numberOfRecordsUpdated: 0,
      });
    });
    const result = checkNearLimitRow(executor, "synthetic-company");
    if (mode === "intact") {
      await expect(result).resolves.toMatchObject({
        titleBytes: 48128,
        rowBytes: 48600,
        intact: true,
      });
      expect(executor.commit).toHaveBeenCalledTimes(2);
    } else {
      await expect(result).rejects.toThrow(/Near-limit/u);
      expect(executor.rollback).toHaveBeenCalled();
    }
  },
);
