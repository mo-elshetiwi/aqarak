import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl";
import { getMessages } from "@aqarak/i18n";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/render-with-intl";
import { MOCK_COMPANY_A_ID, MOCK_COMPANIES } from "@/lib/api/mock-fixtures";
import { seedVersion, resetJ3Mock, createJ3MockClient } from "../_lib/j3-mock";
import { fieldCatalogue, type VersionDetail } from "../_lib/j3-contract";
const doubles = vi.hoisted(() => ({
  save: vi.fn(),
  record: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("../_lib/load-page", () => ({
  pageAccess: () =>
    Promise.resolve({
      ok: true,
      access: { sessionId: "session", companyId: MOCK_COMPANY_A_ID },
    }),
  hideMissing: (result: unknown) => result,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: doubles.refresh, push: doubles.push }),
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: () => {
    throw new Error("redirect");
  },
}));
vi.mock("next-intl/server", () => ({
  getTranslations: ({
    locale,
    namespace,
  }: {
    locale: "en" | "ar";
    namespace: "Tenants";
  }) =>
    Promise.resolve(
      createTranslator({ locale, messages: getMessages(locale), namespace }),
    ),
}));
vi.mock("@/lib/session/session", () => ({
  getCurrentSession: () =>
    Promise.resolve({ sessionId: "session", me: { contexts: [] } }),
  requireCompanyContext: () =>
    Promise.resolve({
      ...MOCK_COMPANIES.a,
      staffRoles: ["manager"],
      partyLinks: [],
    }),
}));
vi.mock("../_lib/j3", () => ({ getJ3Client: () => createJ3MockClient() }));
vi.mock("../_lib/actions", () => ({
  saveIdentityAction: doubles.save,
  inviteTenantAction: vi.fn(),
  rejectUploadAction: vi.fn(),
  requestUploadAction: vi.fn(),
  completeUploadAction: vi.fn(),
  startExtractionAction: vi.fn(),
  recordDecisionsAction: doubles.record,
}));
import OnboardingPage from "../[tenantId]/page";
import TenantsPage from "../page";
import { CheckAnswers } from "./check-answers";
import { ReviewForm } from "./review-form";
beforeEach(() => {
  resetJ3Mock();
  vi.clearAllMocks();
});
describe("W-2 bilingual onboarding", () => {
  it.each(["en", "ar"] as const)(
    "renders three tasks and one primary in %s, masks only the list",
    async (locale) => {
      const route = {
        locale,
        companyId: MOCK_COMPANY_A_ID,
        tenantId: "tenant-1",
      };
      const messages = getMessages(locale).Tenants;
      const page = await OnboardingPage({
        params: Promise.resolve(route),
        searchParams: Promise.resolve({}),
      });
      const view = renderWithIntl(page, { locale });
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        `${messages.onboard} ${locale === "en" ? "Fatima Al Dhaheri" : "فاطمة الظاهري"}`,
      );
      expect(screen.getByRole("list").children).toHaveLength(3);
      expect(
        view.container.querySelectorAll('[data-variant="default"]'),
      ).toHaveLength(1);
      expect(screen.getByRole("link", { name: messages.review })).toBeVisible();
      expect(screen.queryByText("784-****-*******-5")).not.toBeInTheDocument();
      view.unmount();
      renderWithIntl(await TenantsPage({ params: Promise.resolve(route) }), {
        locale,
      });
      expect(screen.queryByText("784-****-*******-5")).not.toBeInTheDocument();
      expect(screen.queryByText("784-1960-0001031-2")).not.toBeInTheDocument();
    },
  );
});
function decidedVersion(): VersionDetail {
  const version = seedVersion();
  version.decisions = fieldCatalogue.map((field) => ({
    fieldName: field.name,
    decision: "edited",
    value: field.name === "name_en" ? "Checked name" : "checked",
    sourceViewed: true,
    provenance: "human_entered",
    version: 1,
    decidedBy: "manager",
    decidedAt: "2026-09-28T04:00:00Z",
  }));
  return version;
}
it("W-4 keeps checked answers on stale save and offers reload", async () => {
  doubles.save.mockResolvedValue({ ok: false, code: "STALE_VERSION" });
  const version = decidedVersion();
  renderWithIntl(
    <CheckAnswers
      route={{
        locale: "en",
        companyId: MOCK_COMPANY_A_ID,
        tenantId: "tenant-1",
        documentId: version.documentId,
        versionId: version.id,
      }}
      tenantVersion={7}
      version={version}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Save identity" }));
  await waitFor(() => {
    expect(screen.getByRole("alert")).toHaveFocus();
  });
  expect(
    within(screen.getByRole("alert")).getByText(
      "This tenant changed since you opened the page",
    ),
  ).toBeVisible();
  expect(screen.getByText("Checked name")).toBeVisible();
  expect(screen.getByRole("button", { name: "Save identity" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Reload tenant" }));
  expect(doubles.refresh).toHaveBeenCalledOnce();
  expect(screen.getByText("Checked name")).toBeVisible();
});
it("W-5 failed extraction opens empty manual suggestions with the notice", () => {
  const version = {
    ...seedVersion(),
    fields: null,
    processingStatus: "extraction_failed",
  };
  renderWithIntl(
    <ReviewForm
      route={{
        locale: "en",
        companyId: MOCK_COMPANY_A_ID,
        tenantId: "tenant-1",
        documentId: version.documentId,
        versionId: version.id,
      }}
      version={version}
      imageUrl="/synthetic/emirates-id-sample.jpg"
      synthetic
    />,
  );
  expect(
    screen.getByText(
      "The document could not be read automatically. Enter the fields from the image.",
    ),
  ).toBeVisible();
  expect(screen.getAllByTestId(/^field-/)).toHaveLength(10);
  expect(screen.queryByText("784-1960-0001031-2")).not.toBeInTheDocument();
});

it("preserves edited answers when changing one field and keeps panel state after a refusal", async () => {
  doubles.record.mockResolvedValue({
    ok: false,
    code: "FIELD_INVALID",
    field: "name_en",
  });
  const version = decidedVersion();
  renderWithIntl(
    <ReviewForm
      route={{
        locale: "en",
        companyId: MOCK_COMPANY_A_ID,
        tenantId: "tenant-1",
        documentId: version.documentId,
        versionId: version.id,
      }}
      version={version}
      imageUrl="/synthetic/emirates-id-sample.jpg"
      synthetic
      changeField="name_en"
    />,
  );
  expect(screen.getByText("Checked name")).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "Accept Name in English" }),
  );
  const next = screen.getByRole("button", {
    name: "Continue to check answers",
  });
  await userEvent.click(next);
  await waitFor(() => {
    expect(screen.getByRole("alert")).toHaveFocus();
  });
  expect(screen.getByTestId("field-name_en")).toHaveAttribute(
    "data-state",
    "accepted",
  );
  expect(
    within(screen.getByTestId("field-name_en")).getByText(
      "Name in English: Check this field against the document.",
    ),
  ).toBeVisible();
  expect(doubles.record).toHaveBeenCalledOnce();
  expect(doubles.record.mock.calls[0]?.[0]).toHaveProperty(
    "decisions.name_en.status",
    "edited",
  );
  expect(doubles.record.mock.calls[0]?.[0]).toHaveProperty(
    "decisions.name_en.value",
    "Checked name",
  );
  expect(doubles.record.mock.calls[0]?.[0]).toHaveProperty(
    "decisions.id_number.value",
    "checked",
  );
  const firstCall: unknown = doubles.record.mock.calls[0]?.[0];
  await userEvent.click(next);
  expect(doubles.record.mock.calls[1]?.[0]).toEqual(firstCall);
});
