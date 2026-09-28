import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { getMessages } from "@aqarak/i18n";
import { renderWithIntl } from "@/test/render-with-intl";
import { DocumentProcessing } from "../components/document-processing";
import { PropertyRecord } from "../components/property-record";
import { propertyDetailSchema } from "../contract";
import fixture from "./fixtures/property-detail.synthetic.json";
vi.mock("../actions", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe.each(["en", "ar"] as const)("AC-0 %s document states", (locale) => {
  const t = getMessages(locale).Properties;
  it("explains checksum rejection in the document row and offers upload again", () => {
    const property = propertyDetailSchema.parse(fixture);
    const version = property.documents[0]?.latest;
    if (!version) throw new Error("Missing synthetic document version");
    version.processingStatus = "scan_rejected";
    version.scanResult = "checksum_mismatch";
    renderWithIntl(
      <PropertyRecord
        companyId="10000000-0000-4000-8000-000000000001"
        property={property}
      />,
      { locale },
    );
    expect(screen.getByText(t.scanReasons.checksum_mismatch)).toBeVisible();
    expect(screen.getByRole("button", { name: t.uploadAgain })).toBeVisible();
  });

  it("uses the pending flag with the uploaded state", () => {
    const version = propertyDetailSchema.parse(fixture).documents[0]?.latest;
    if (!version) throw new Error("Missing synthetic document version");
    version.processingStatus = "uploaded";
    renderWithIntl(
      <DocumentProcessing
        version={version}
        namespace="Properties"
        scanPending
      />,
      { locale },
    );
    expect(screen.getByText(t.checking)).toBeVisible();
  });
});
