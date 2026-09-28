import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getMessages } from "@aqarak/i18n";
import { renderWithIntl } from "@/test/render-with-intl";
import { seedRecords } from "../_lib/fixtures";
import { criticalFields, type Extraction } from "../_lib/schemas";
import { ExtractionReview } from "./review";
import type { RunAction } from "./use-mutation";
const record = seedRecords()[0];
if (!record) throw new Error("Missing synthetic record");
record.document = {
  documentVersionId: "69000000-0000-4000-8000-000000000001",
  versionNo: 1,
  contentType: "image/png",
  byteSize: 1000,
  processingStatus: "scan_clean",
  reviewStatus: "pending_review",
  rejectReason: null,
  createdAt: "2026-09-28T00:00:00Z",
};
const values = {
  tawtheeq_number: "SYNTHETIC-C-TW-01",
  registered_on: "2026-09-28",
  unt_number: "UNT-107",
  owner_id_number: "784-0000-0000001-1",
  tenant_id_number: "784-0000-0000002-2",
};
const extraction: Extraction = {
  status: "succeeded",
  degradedMode: null,
  extractionId: "71000000-0000-4000-8000-000000000001",
  registryEntry: "synthetic",
  confidenceLabel: "uncalibrated",
  comparisonPreview: [],
  fields: Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      { value, evidence: value, nullReason: null },
    ]),
  ),
};
for (const locale of ["en", "ar"] as const)
  describe(`${locale} extraction review`, () => {
    const t = getMessages(locale).Tawtheeq;
    it("requires each critical decision and sends edited or extracted provenance", async () => {
      const run = vi.fn<RunAction>().mockResolvedValue({ ok: true, record });
      renderWithIntl(
        <ExtractionReview
          record={record}
          extraction={extraction}
          sourceAvailable
          run={run}
        />,
        { locale },
      );
      const submit = screen.getByRole("button", { name: t.reviewSubmit });
      expect(submit).toBeDisabled();
      expect(screen.getAllByText(t.notCalibrated)).toHaveLength(12);
      fireEvent.change(
        screen.getByLabelText(t.fields.tawtheeq_number, { exact: true }),
        { target: { value: "SYNTHETIC-EDITED" } },
      );
      for (const field of criticalFields.slice(1))
        fireEvent.click(
          screen.getByRole("checkbox", {
            name: t.confirm.replace("{field}", t.fields[field]),
          }),
        );
      expect(submit).toBeEnabled();
      fireEvent.click(submit);
      await waitFor(() => {
        expect(run).toHaveBeenCalledOnce();
      });
      expect(run.mock.calls[0]?.[0]).toMatchObject({
        command: "submitReview",
        input: {
          fields: {
            tawtheeq_number: {
              value: "SYNTHETIC-EDITED",
              provenance: "edited",
            },
            tenant_id_number: {
              value: values.tenant_id_number,
              provenance: "extracted",
            },
          },
        },
      });
    });
    it("opens degraded extraction empty, shows its reason and sends manual provenance", async () => {
      const run = vi.fn<RunAction>().mockResolvedValue({ ok: true, record });
      renderWithIntl(
        <ExtractionReview
          record={record}
          extraction={{
            ...extraction,
            status: "degraded",
            extractionId: null,
            degradedMode: "manual_entry",
            fields: {},
          }}
          sourceAvailable
          run={run}
        />,
        { locale },
      );
      expect(screen.getByRole("status")).toHaveTextContent(t.manual_entry);
      for (const [key, value] of Object.entries(values)) {
        const label = t.fields[key as keyof typeof values];
        const input = screen.getByLabelText(label, { exact: true });
        expect(input).toHaveValue("");
        fireEvent.change(input, { target: { value } });
      }
      fireEvent.click(screen.getByRole("button", { name: t.reviewSubmit }));
      await waitFor(() => {
        expect(run).toHaveBeenCalledOnce();
      });
      expect(run.mock.calls[0]?.[0]).toMatchObject({
        input: {
          extractionId: null,
          fields: { tenant_id_number: { provenance: "manual" } },
        },
      });
    });
    it("keeps confirmation disabled while the source is unavailable", () => {
      renderWithIntl(
        <ExtractionReview
          record={record}
          extraction={extraction}
          sourceAvailable={false}
          run={vi.fn<RunAction>()}
        />,
        { locale },
      );
      expect(
        screen.getByRole("button", { name: t.reviewSubmit }),
      ).toBeDisabled();
      for (const checkbox of screen.getAllByRole("checkbox"))
        expect(checkbox).toBeDisabled();
    });
  });
