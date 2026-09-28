import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { getMessages as getShellMessages } from "./catalogues";
import enTenants from "../../../packages/i18n/messages/en/Tenants.json" with { type: "json" };
import arTenants from "../../../packages/i18n/messages/ar/Tenants.json" with { type: "json" };
import enDocuments from "../../../packages/i18n/messages/en/Documents.json" with { type: "json" };
import arDocuments from "../../../packages/i18n/messages/ar/Documents.json" with { type: "json" };
function getMessages(locale: "en" | "ar"): ReturnType<
  typeof getShellMessages
> & {
  Tenants: typeof enTenants;
  Documents: typeof enDocuments;
} {
  return {
    ...getShellMessages(locale),
    Tenants: locale === "en" ? enTenants : arTenants,
    Documents: locale === "en" ? enDocuments : arDocuments,
  };
}
import {
  MOCK_COMPANY_A_ID,
  MOCK_COMPANY_B_ID,
} from "../src/lib/api/mock-fixtures";
import { signIn } from "./helpers";
async function accessible(page: Page): Promise<void> {
  const report = await new AxeBuilder({ page }).analyze();
  expect(
    report.violations.filter(
      (item) => item.impact === "serious" || item.impact === "critical",
    ),
  ).toEqual([]);
  await expect(page.locator("h1")).toHaveCount(1);
  expect(
    await page.locator('main [data-variant="default"]:visible').count(),
  ).toBeLessThanOrEqual(1);
}
test("T-7 manager creates, invites, rejects and uploads again in both languages", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "manager-1", "en");
  for (const locale of ["en", "ar"] as const) {
    const { Tenants: t, Documents: d } = getMessages(locale);
    const base = `/${locale}/companies/${MOCK_COMPANY_A_ID}/tenants`;
    await page.goto(base);
    await accessible(page);
    await page.getByRole("link", { name: t.add, exact: true }).click();
    await expect(page.locator("h1")).toHaveText(t.create.title);
    await expect(
      page.getByRole("banner").getByRole("navigation", { name: t.title }),
    ).toBeVisible();
    await accessible(page);
    await page
      .getByLabel(t.create.fullNameEn, { exact: true })
      .fill(`Synthetic Tenant ${locale}`);
    await page
      .getByLabel(t.create.fullNameAr, { exact: true })
      .fill("مستأجر تجريبي");
    await page
      .getByLabel(t.create.email, { exact: true })
      .fill(`synthetic-${locale}@example.com`);
    await page.getByRole("radio", { name: t[locale], exact: true }).check();
    await page.getByRole("button", { name: t.add, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${base}/[a-f0-9-]+$`));
    await expect(
      page.getByText(t.invitation.notInvited, { exact: true }),
    ).toBeVisible();
    await accessible(page);
    await page
      .getByRole("button", { name: t.invitation.send, exact: true })
      .click();
    await expect(
      page.getByText(t.invitation.recorded, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(t.invitation.pending, { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText(t.invitation.pending, { exact: true }),
    ).toBeVisible();
    await accessible(page);
    await page.goto(`${base}/tenant-1`);
    if (locale === "ar") {
      await page
        .getByRole("button", { name: t.uploadAgain, exact: true })
        .click();
      const capture = page.getByRole("dialog");
      await capture
        .getByLabel(d.chooseFile, { exact: true })
        .setInputFiles("public/synthetic/emirates-id-sample.jpg");
      await accessible(page);
      await capture.getByRole("button", { name: d.start, exact: true }).click();
      await expect(page.getByText(d.manual, { exact: true })).toBeVisible();
    } else
      await page.getByRole("link", { name: t.review, exact: true }).click();
    await expect(page.locator("h1")).toHaveText(d.reviewTitle);
    await expect(
      page.getByRole("banner").getByRole("navigation", { name: t.title }),
    ).toBeVisible();
    await accessible(page);
    await page
      .getByRole("button", { name: d.rejectUpload.title, exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByText(d.rejectUpload.consequence, { exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole("radio", {
        name: d.rejectUpload.reasons.illegible,
        exact: true,
      })
      .check();
    await dialog
      .getByLabel(d.rejectUpload.note, { exact: true })
      .fill("Synthetic unreadable upload");
    await accessible(page);
    await dialog
      .getByRole("button", { name: d.rejectUpload.confirm, exact: true })
      .click();
    await expect(page).toHaveURL(`${base}/tenant-1`);
    const identity = page.getByRole("listitem").filter({
      has: page.getByRole("heading", {
        name: t.documents.emirates_id,
        exact: true,
      }),
    });
    await expect(
      identity.getByText(t.taskStatus.rejected, { exact: true }),
    ).toBeVisible();
    await expect(
      identity.getByRole("button", { name: t.uploadAgain, exact: true }),
    ).toBeVisible();
    await accessible(page);
  }
});
test("T-7 conceals unknown identifiers and denies tenant accounts in both languages", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, "manager-1", "en");
  for (const locale of ["en", "ar"] as const) {
    const m = getMessages(locale);
    for (const companyId of [MOCK_COMPANY_A_ID, MOCK_COMPANY_B_ID]) {
      await page.goto(
        `/${locale}/companies/${companyId}/tenants/unknown-tenant`,
      );
      await expect(
        page.getByText(m.States.notFound, { exact: true }),
      ).toBeVisible();
      await accessible(page);
    }
  }
  await page.context().clearCookies();
  await signIn(page, "tenant-1", "en");
  for (const locale of ["en", "ar"] as const) {
    const m = getMessages(locale);
    for (const path of [
      "",
      "/new",
      "/tenant-1",
      "/tenant-1/documents/document/versions/version/review",
      "/tenant-1/documents/document/versions/version/review/check",
    ]) {
      await page.goto(
        `/${locale}/companies/${MOCK_COMPANY_A_ID}/tenants${path}`,
      );
      await expect(
        page.getByText(m.States.notPermitted, { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: m.Tenants.add, exact: true }),
      ).toHaveCount(0);
      await accessible(page);
    }
  }
});
