import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import enTenants from "../../../packages/i18n/messages/en/Tenants.json" with { type: "json" };
import arTenants from "../../../packages/i18n/messages/ar/Tenants.json" with { type: "json" };
import enDocuments from "../../../packages/i18n/messages/en/Documents.json" with { type: "json" };
import arDocuments from "../../../packages/i18n/messages/ar/Documents.json" with { type: "json" };
import enReview from "../../../packages/i18n/messages/en/Review.json" with { type: "json" };
import arReview from "../../../packages/i18n/messages/ar/Review.json" with { type: "json" };
import { MOCK_COMPANY_A_ID } from "../src/lib/api/mock-fixtures";
import { signIn } from "./helpers";
async function accessible(page: Page): Promise<void> {
  const report = await new AxeBuilder({ page }).analyze();
  expect(
    report.violations.filter(
      (entry) => entry.impact === "serious" || entry.impact === "critical",
    ),
  ).toEqual([]);
}
test("W-7 manager reviews seeded tenant identity in both languages", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await signIn(page, "manager-1", "en");
  let reviewUrl = "";
  for (const locale of ["en", "ar"] as const) {
    const tenants = locale === "en" ? enTenants : arTenants;
    const documents = locale === "en" ? enDocuments : arDocuments;
    const review = locale === "en" ? enReview : arReview;
    if (locale === "en")
      await page
        .getByTestId("desktop-sidebar")
        .getByRole("link", { name: tenants.title, exact: true })
        .click();
    else await page.goto(`/${locale}/companies/${MOCK_COMPANY_A_ID}/tenants`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      tenants.title,
    );
    await expect(
      page.getByText("784-1984-0008869-0", { exact: true }),
    ).toHaveCount(0);
    await accessible(page);
    await page.screenshot({
      path: testInfo.outputPath(`list-${locale}.png`),
      fullPage: true,
    });
    await page.getByRole("link", { name: /Fatima Al Dhaheri/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      `${tenants.onboard} ${locale === "en" ? "Fatima Al Dhaheri" : "فاطمة الظاهري"}`,
    );
    const tasks = page.getByRole("region", { name: tenants.tasks });
    await expect(tasks.getByRole("listitem")).toHaveCount(3);
    await expect(page.locator('main [data-variant="default"]')).toHaveCount(1);
    await accessible(page);
    await page.screenshot({
      path: testInfo.outputPath(`onboarding-${locale}.png`),
      fullPage: true,
    });
    await page.getByRole("link", { name: tenants.review, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      documents.reviewTitle,
    );
    reviewUrl = page.url();
    await accessible(page);
    await page.screenshot({
      path: testInfo.outputPath(`review-${locale}.png`),
      fullPage: true,
    });
    for (const name of Object.keys(
      documents.fields,
    ) as (keyof typeof documents.fields)[]) {
      const row = page.getByTestId(`field-${name}`);
      const label = documents.fields[name];
      if (name === "expiry_date") {
        const source = row.getByRole("button", {
          name: review.viewSource.replace("{field}", label),
          exact: true,
        });
        await source.focus();
        await page.keyboard.press("Enter");
        await expect(
          row.getByText(review.sourceOpened, { exact: true }),
        ).toBeVisible();
      }
      if (name === "card_number" || name === "sex") {
        const absent = row.getByRole("button", {
          name: review.notOnDocument,
          exact: true,
        });
        await absent.focus();
        await page.keyboard.press("Enter");
      } else {
        const accept = row.getByRole("button", {
          name: review.acceptField.replace("{field}", label),
          exact: true,
        });
        await accept.focus();
        await page.keyboard.press("Enter");
      }
      await expect(row).toHaveAttribute(
        "data-state",
        name === "card_number" || name === "sex"
          ? "not_on_document"
          : "accepted",
      );
      await expect(
        row.getByRole("button", {
          name: review.editField.replace("{field}", label),
          exact: true,
        }),
      ).toBeFocused();
    }
    const next = page.getByRole("button", {
      name: review.continue,
      exact: true,
    });
    await next.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${reviewUrl}/check`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      documents.checkTitle,
    );
    await expect(
      page.getByText("784-1984-0008869-0", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(documents.noNotification, { exact: true }),
    ).toBeVisible();
    await accessible(page);
    await page.screenshot({
      path: testInfo.outputPath(`check-${locale}.png`),
      fullPage: true,
    });
  }
});

test("W-5 browser upload opens manual review and saves entered fields", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await signIn(page, "manager-1", "en");
  await page.goto(`/en/companies/${MOCK_COMPANY_A_ID}/tenants/tenant-2`);
  await page
    .getByRole("button", { name: enTenants.upload, exact: true })
    .click();
  const sheet = page.getByRole("dialog");
  await expect(
    sheet.getByText(enDocuments.nothingSaved, { exact: true }),
  ).toBeVisible();
  await sheet
    .getByLabel(enDocuments.chooseFile, { exact: true })
    .setInputFiles("public/synthetic/emirates-id-sample.jpg");
  await page.screenshot({
    path: testInfo.outputPath("capture-en.png"),
    fullPage: true,
  });
  await accessible(page);
  await sheet
    .getByRole("button", { name: enDocuments.start, exact: true })
    .click();
  await expect(
    page.getByText(enDocuments.manual, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: enDocuments.imageAlt, exact: true }),
  ).toBeVisible();
  const values: Record<keyof typeof enDocuments.fields, string | null> = {
    id_number: "784-1984-0008869-0",
    name_en: "Fatima Al Dhaheri",
    name_ar: "فاطمة الظاهري",
    nationality_en: "Pakistan",
    nationality_ar: "باكستان",
    date_of_birth: "1984-01-19",
    sex: null,
    issue_date: "2024-09-10",
    expiry_date: "2028-09-10",
    card_number: null,
  };
  for (const name of Object.keys(values) as (keyof typeof values)[]) {
    const row = page.getByTestId(`field-${name}`);
    const label = enDocuments.fields[name];
    const value = values[name];
    const edit = row.getByRole("button", {
      name: enReview.editField.replace("{field}", label),
      exact: true,
    });
    if (value === null) {
      await row
        .getByRole("button", { name: enReview.notOnDocument, exact: true })
        .click();
      await expect(row).toHaveAttribute("data-state", "not_on_document");
    } else {
      await edit.focus();
      await page.keyboard.press("Enter");
      await row.locator("input").fill(value);
      await row.locator("input").press("Enter");
      await expect(row).toHaveAttribute("data-state", "edited");
    }
    await expect(edit).toBeFocused();
  }
  await page
    .getByRole("button", { name: enReview.continue, exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    enDocuments.checkTitle,
  );
  await expect(
    page.getByText(enDocuments.provenance.human_entered, { exact: true }),
  ).toHaveCount(8);
  await page
    .getByRole("button", { name: enDocuments.save, exact: true })
    .click();
  await expect(page.getByText(enTenants.saved, { exact: true })).toBeVisible();
  const task = page.getByRole("listitem").filter({
    has: page.getByRole("heading", {
      name: enTenants.documents.emirates_id,
      exact: true,
    }),
  });
  await expect(task.locator('[data-task-status="accepted"]')).toBeVisible();
  await page.goto(`/en/companies/${MOCK_COMPANY_A_ID}/tenants`);
  await expect(
    page.getByText("784-****-*******-0", { exact: true }),
  ).toBeVisible();
});
