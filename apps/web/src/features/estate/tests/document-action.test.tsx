import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getMessages } from "@aqarak/i18n";
import { renderWithIntl } from "@/test/render-with-intl";
import { MOCK_COMPANY_A_ID } from "@/lib/api/mock-fixtures";
import { propertyDetailSchema } from "../contract";
import propertyFixture from "./fixtures/property-detail.synthetic.json";
const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  checkOwnerDocumentAction: vi.fn(),
  checkPropertyDocumentAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("../actions", () => mocks);
import { DocumentAction } from "../components/document-action";

beforeEach(() => {
  vi.resetAllMocks();
});
describe.each(["en", "ar"] as const)("%s document checks", (locale) => {
  it.each(["owners", "properties"] as const)(
    "checks a pending %s upload directly and rotates the key after success",
    async (entity) => {
      const document = propertyDetailSchema.parse(propertyFixture).documents[0];
      if (!document?.latest) throw new Error("Missing synthetic document");
      document.latest.processingStatus = "uploaded";
      const action =
        entity === "owners"
          ? mocks.checkOwnerDocumentAction
          : mocks.checkPropertyDocumentAction;
      action.mockResolvedValue({
        ok: true,
        data: {
          version: { ...document.latest, processingStatus: "scan_clean" },
          scanPending: false,
        },
      });
      const onOpen = vi.fn();
      const t =
        getMessages(locale)[entity === "owners" ? "Owners" : "Properties"];
      renderWithIntl(
        <DocumentAction
          companyId={MOCK_COMPANY_A_ID}
          recordId={propertyFixture.id}
          entity={entity}
          document={document}
          docType={document.docType}
          onOpen={onOpen}
        />,
        { locale },
      );
      await userEvent.click(screen.getByRole("button", { name: t.check }));
      expect(action).toHaveBeenCalledOnce();
      expect(action.mock.calls[0]?.[2]).toEqual([
        propertyFixture.id,
        document.documentId,
        document.latest.versionId,
      ]);
      expect(onOpen).not.toHaveBeenCalled();
      expect(screen.getByText(t.statusChecked)).toBeVisible();
      expect(mocks.refresh).toHaveBeenCalledOnce();
      await userEvent.click(screen.getByRole("button", { name: t.check }));
      expect(action.mock.calls[1]?.[0]).not.toEqual(action.mock.calls[0]?.[0]);
    },
  );
});
