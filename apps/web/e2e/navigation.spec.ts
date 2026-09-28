import { expect, test } from "@playwright/test";
import { getMessages } from "./catalogues";
import {
  MOCK_COMPANY_A_ID,
  MOCK_COMPANY_B_ID,
  MOCK_COMPANIES,
} from "../src/lib/api/mock-fixtures";
import { expectedIds, expectNavigation, signIn } from "./helpers";
for (const handle of Object.keys(expectedIds) as (keyof typeof expectedIds)[]) {
  if (handle === "owner-2") continue;
  test(`AC-6 exact ${handle} navigation`, async ({ page }) => {
    await signIn(page, handle);
    await expectNavigation(page, handle);
    if (handle === "technician-1")
      await expect(
        page.getByText("Jobs are handled in the Aqarak mobile app."),
      ).toBeVisible();
  });
}
test("AC-6 Arabic tenant navigation", async ({ page }) => {
  await signIn(page, "tenant-1", "ar");
  await expectNavigation(page, "tenant-1", "ar");
});
test("AC-7 conceals foreign and missing companies and distinguishes a denied section", async ({
  page,
}) => {
  await signIn(page);
  const messages = getMessages("en");
  for (const id of [
    MOCK_COMPANY_B_ID,
    "10000000-0000-4000-8000-000000000099",
  ]) {
    const response = await page.goto(`/en/companies/${id}/home`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      messages.Shell.notFound,
    );
    await expect(page.getByText(messages.States.notFound)).toBeVisible();
  }
  await page.goto(`/en/companies/${MOCK_COMPANY_A_ID}/members`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    messages.Shell.notPermitted,
  );
  await expect(page.getByText(messages.States.notPermitted)).toBeVisible();
  await expect(page.getByText(messages.Navigation.empty.members)).toHaveCount(
    0,
  );
  const response = await page.goto(
    `/en/companies/${MOCK_COMPANY_A_ID}/unknown-section`,
  );
  expect(response?.status()).toBe(404);
});
test("AC-8 chooses between companies and unions capacities in the URL context", async ({
  page,
}) => {
  await signIn(page, "owner-2");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Choose a company",
  );
  await expect(page.getByText("Demo", { exact: true })).toHaveCount(2);
  await expect(
    page.getByRole("link", {
      name: new RegExp(MOCK_COMPANIES.a.companyName.en),
    }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: new RegExp(MOCK_COMPANIES.b.companyName.en) })
    .click();
  await expect(page).toHaveURL(`/en/companies/${MOCK_COMPANY_B_ID}/home`);
  await expectNavigation(page, "owner-2");
  await page.getByRole("button", { name: "Switch company" }).click();
  await page
    .getByRole("menuitem", { name: MOCK_COMPANIES.a.companyName.en })
    .click();
  await expect(page).toHaveURL(`/en/companies/${MOCK_COMPANY_A_ID}/home`);
  await expectNavigation(page, "owner-1");
});
test("AC-10 language and theme preserve the company and section", async ({
  page,
}) => {
  await signIn(page);
  await page
    .getByTestId("desktop-sidebar")
    .getByText("More", { exact: true })
    .click();
  await page.getByRole("radio", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  const link = page.getByRole("link", {
    name: "Change language العربية",
    exact: true,
  });
  await expect(link).toHaveAccessibleName(/العربية/);
  await link.click();
  await expect(page).toHaveURL(`/ar/companies/${MOCK_COMPANY_A_ID}/home`);
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("الرئيسية");
});
for (const locale of ["en", "ar"] as const) {
  test(`AC-12 ${locale} mobile navigation closes with Escape and returns focus`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, "manager-1", locale);
    const messages = getMessages(locale);
    const button = page.getByRole("button", {
      name: messages.Shell.openNavigation,
    });
    await expect(page.getByTestId("desktop-sidebar")).not.toBeVisible();
    await button.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("navigation")).toBeVisible();
    const bounds = await sheet.boundingBox();
    if (!bounds) throw new Error("Missing navigation bounds");
    if (locale === "ar") expect(Math.round(bounds.x + bounds.width)).toBe(390);
    else expect(bounds.x).toBe(0);
    await page.keyboard.press("Escape");
    await expect(sheet).not.toBeVisible();
    await expect(button).toBeFocused();
  });
}
