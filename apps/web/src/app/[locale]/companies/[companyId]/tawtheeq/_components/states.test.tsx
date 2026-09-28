import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getMessages } from "@aqarak/i18n";
import { renderWithIntl } from "@/test/render-with-intl";
import { Board } from "./board";
import { ActionError, LoadFailure } from "./common";
import { UploadPanel } from "./upload";
import { seedRecords } from "../_lib/fixtures";
import { vi } from "vitest";
import type { RunAction } from "./use-mutation";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const t = getMessages("en").Tawtheeq;
describe("Tawtheeq distinct recovery states", () => {
  it("shows no records without claiming a filter mismatch", () => {
    renderWithIntl(
      <Board records={[]} locale="en" companyId="synthetic" synthetic />,
    );
    expect(screen.getByText(t.noRecords)).toBeVisible();
    expect(screen.queryByText(t.noMatches)).not.toBeInTheDocument();
  });
  it("offers retry for a load failure", () => {
    const retry = vi.fn();
    renderWithIntl(<LoadFailure retry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: t.retry }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it("rejects oversized and unsupported files before requesting storage", () => {
    const record = seedRecords()[0];
    if (!record) throw new Error("Missing record");
    const run = vi.fn<RunAction>();
    renderWithIntl(<UploadPanel record={record} run={run} />);
    const file = new File(["synthetic"], "synthetic.exe", {
      type: "application/octet-stream",
    });
    fireEvent.change(screen.getByLabelText(t.uploadLabel), {
      target: { files: [file] },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(t.fileInvalid);
    expect(screen.getByRole("button", { name: t.upload })).toBeDisabled();
    expect(run).not.toHaveBeenCalled();
  });
});

it.each([
  ["CHECKSUM_MISMATCH", "checksumFailed"],
  ["SCAN_REJECTED", "scanRejected"],
  ["SCAN_PENDING", "scanPending"],
  ["UPLOAD_EXPIRED", "expiredUpload"],
  ["UPLOAD_FAILED", "uploadFailed"],
  ["UNAVAILABLE", "unavailable"],
] as const)(
  "shows distinct %s recovery beside the failed action",
  (code, message) => {
    renderWithIntl(
      <ActionError error={{ ok: false, code, fieldErrors: {} }} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(t[message]);
    expect(screen.getByRole("alert")).toHaveFocus();
  },
);
