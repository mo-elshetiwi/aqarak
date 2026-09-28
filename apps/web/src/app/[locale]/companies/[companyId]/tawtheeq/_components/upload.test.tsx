import { useState, type ReactElement } from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMessages } from "@aqarak/i18n";
import { renderWithIntl } from "@/test/render-with-intl";
import { seedRecords, mockRecordIds } from "../_lib/fixtures";
import { describeUpload, putCertificate } from "../_lib/upload";
import { tawtheeqAction, type ActionFailure } from "../[recordId]/_actions";
import { RecordScreen } from "./record";
import { UploadPanel } from "./upload";
import type { RunAction } from "./use-mutation";

vi.mock("../[recordId]/_actions", () => ({ tawtheeqAction: vi.fn() }));
vi.mock("@/components/shell/session-context", () => ({
  useCsrfToken: () => "synthetic",
}));
vi.mock("../_lib/upload", async (original) => ({
  ...(await original<typeof import("../_lib/upload")>()),
  describeUpload: vi.fn(),
  putCertificate: vi.fn(),
}));
const record = seedRecords().find((r) => r.id === mockRecordIds.awaiting);
if (!record) throw new Error("Missing synthetic record");
const initial = record;
const documentId = "66000000-0000-4000-8000-000000000001";
const upload = {
  documentVersionId: documentId,
  upload: {
    url: "/synthetic",
    method: "PUT" as const,
    headers: {},
    expiresAt: "2026-09-28T09:00:00Z",
  },
};
const pending: ActionFailure = {
  ok: false,
  code: "INVALID_TRANSITION",
  domainCode: "SCAN_PENDING",
  fieldErrors: {},
};
const clean = {
  ...initial,
  workflowState: "under_review" as const,
  version: initial.version + 1,
  allowedActions: [],
  document: {
    documentVersionId: documentId,
    versionNo: 1,
    contentType: "image/png" as const,
    byteSize: 4,
    processingStatus: "scan_clean" as const,
    reviewStatus: "pending_review" as const,
    rejectReason: null,
    createdAt: "2026-09-28T08:00:00Z",
  },
};
const t = getMessages("en").Tawtheeq;
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(describeUpload).mockResolvedValue({
    fileName: "synthetic.png",
    contentType: "image/png",
    byteSize: 4,
    sha256: "a".repeat(64),
  });
  vi.mocked(putCertificate).mockResolvedValue();
});
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});
async function selectAndUpload(labels = t): Promise<File> {
  const file = new File(["synthetic"], "synthetic.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText(labels.uploadLabel), {
    target: { files: [file] },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: labels.upload }));
    await Promise.resolve();
  });
  return file;
}
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function renderRecord(locale: "en" | "ar"): void {
  renderWithIntl(
    <RecordScreen
      initialRecord={initial}
      initialSource={null}
      companyId="synthetic"
      locale={locale}
      synthetic
    />,
    { locale },
  );
}

describe("AC-2 scan completion", () => {
  it.each(["en", "ar"] as const)(
    "%s keeps pending state then enters review after a clean retry",
    async (locale) => {
      const labels = getMessages(locale).Tawtheeq;
      vi.mocked(tawtheeqAction)
        .mockResolvedValueOnce({ ok: true, record: initial, upload })
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce({ ok: true, record: clean })
        .mockResolvedValue({ ok: false, code: "UNAVAILABLE", fieldErrors: {} });
      renderRecord(locale);
      const heading = screen.getByRole("heading", { level: 1 }).textContent;
      const file = await selectAndUpload(labels);
      expect(screen.getByText(labels.scanInProgress)).toBeVisible();
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        heading,
      );
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(
        screen.getByLabelText<HTMLInputElement>(labels.uploadLabel).files?.[0],
      ).toBe(file);
      await advance(2999);
      expect(tawtheeqAction).toHaveBeenCalledTimes(2);
      await advance(1);
      const calls = vi.mocked(tawtheeqAction).mock.calls.map(
        ([input]) =>
          input as {
            command: string;
            input: { expectedVersion: number };
            idempotencyKey: string;
          },
      );
      const completions = calls.filter((c) => c.command === "completeUpload");
      expect(completions).toHaveLength(2);
      expect(new Set(completions.map((c) => c.idempotencyKey)).size).toBe(2);
      expect(completions.map((c) => c.input.expectedVersion)).toEqual([
        initial.version,
        initial.version,
      ]);
      expect(screen.queryByText(labels.scanInProgress)).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: labels.extract }),
      ).toBeVisible();
      expect(putCertificate).toHaveBeenCalledOnce();
    },
  );

  it.each(["SCAN_REJECTED", "CHECKSUM_MISMATCH"] as const)(
    "%s preserves the record header and requires a replacement",
    async (code) => {
      vi.mocked(tawtheeqAction)
        .mockResolvedValueOnce({ ok: true, record: initial, upload })
        .mockResolvedValueOnce({
          ok: false,
          code: "VALIDATION_FAILED",
          domainCode: code,
          fieldErrors: {},
        });
      renderRecord("en");
      const heading = screen.getByRole("heading", { level: 1 }).textContent;
      const state = document.querySelector("[data-tone]")?.textContent;
      await selectAndUpload();
      expect(screen.getByRole("alert")).toHaveTextContent(
        code === "SCAN_REJECTED" ? t.scanRejected : t.checksumFailed,
      );
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        heading,
      );
      expect(document.querySelector("[data-tone]")?.textContent).toBe(state);
      expect(screen.getByLabelText(t.uploadLabel)).toBeEnabled();
      expect(
        screen.getByRole("button", { name: t.replaceUpload }),
      ).toBeDisabled();
      fireEvent.change(screen.getByLabelText(t.uploadLabel), {
        target: {
          files: [new File(["new"], "new.png", { type: "image/png" })],
        },
      });
      expect(
        screen.getByRole("button", { name: t.replaceUpload }),
      ).toBeEnabled();
      await advance(60_000);
      expect(tawtheeqAction).toHaveBeenCalledTimes(2);
    },
  );

  it("stops automatic checks at 60 seconds and checks the same upload again on request", async () => {
    const run = vi
      .fn<RunAction>()
      .mockResolvedValueOnce({ ok: true, record: initial, upload })
      .mockResolvedValue(pending);
    renderWithIntl(<UploadPanel record={initial} run={run} />);
    await selectAndUpload();
    for (let i = 0; i < 20; i += 1) await advance(3000);
    expect(run).toHaveBeenCalledTimes(21);
    const check = screen.getByRole("button", {
      name: t.checkAgain,
    });
    expect(check).toBeEnabled();
    await advance(60_000);
    expect(run).toHaveBeenCalledTimes(21);
    run.mockResolvedValueOnce({ ok: true, record: clean });
    await act(async () => {
      fireEvent.click(check);
      await Promise.resolve();
    });
    expect(run).toHaveBeenCalledTimes(22);
    const completions = run.mock.calls.filter(
      ([action]) => action.command === "completeUpload",
    );
    expect(new Set(completions.map(([, key]) => key)).size).toBe(21);
    expect(
      completions.every(
        ([action]) =>
          action.command === "completeUpload" &&
          action.input.documentVersionId === documentId,
      ),
    ).toBe(true);
    expect(putCertificate).toHaveBeenCalledOnce();
  });

  it("uses the current record version on retry and cancels retries when unmounted", async () => {
    const run = vi
      .fn<RunAction>()
      .mockResolvedValueOnce({ ok: true, record: initial, upload })
      .mockResolvedValue(pending);
    function ChangingRecord(): ReactElement {
      const [version, setVersion] = useState(initial.version);
      return (
        <>
          <button
            onClick={() => {
              setVersion(7);
            }}
          >
            {t.reload}
          </button>
          <UploadPanel record={{ ...initial, version }} run={run} />
        </>
      );
    }
    const view = renderWithIntl(<ChangingRecord />);
    await selectAndUpload();
    fireEvent.click(screen.getByRole("button", { name: t.reload }));
    await advance(3000);
    expect(run).toHaveBeenLastCalledWith(
      {
        command: "completeUpload",
        input: { documentVersionId: documentId, expectedVersion: 7 },
      },
      expect.any(String),
    );
    view.unmount();
    await advance(60_000);
    expect(run).toHaveBeenCalledTimes(3);
  });
});
