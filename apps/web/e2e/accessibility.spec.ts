import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import { signIn } from "./helpers";
import { MOCK_COMPANY_A_ID } from "../src/lib/api/mock-fixtures";
async function checkPage(page: Page, titles: Set<string>): Promise<void> {
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  expect(
    await page
      .locator('button[data-variant="default"], a[data-variant="default"]')
      .count(),
  ).toBeLessThanOrEqual(1);
  const title = await page.title();
  expect(title.trim().length).toBeGreaterThan(0);
  expect(titles.has(title)).toBe(false);
  titles.add(title);
  await page.keyboard.press("Tab");
  await expect(page.locator('a[href="#main"]')).toBeFocused();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
}

for (const locale of ["en", "ar"]) {
  test(`${locale} has no serious or critical WCAG violations`, async ({
    page,
  }) => {
    await page.goto(`/${locale}`);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      results.violations.filter(
        (violation) =>
          violation.impact === "serious" || violation.impact === "critical",
      ),
    ).toEqual([]);
  });
}

for (const locale of ["en", "ar"] as const) {
  test(`AC-11 ${locale} account and company pages meet accessibility and document contracts`, async ({
    page,
  }) => {
    const titles = new Set<string>();
    for (const route of ["sign-in", "sign-up", "verify"]) {
      await page.goto(`/${locale}/${route}`);
      await checkPage(page, titles);
    }
    await signIn(page, "manager-1", locale);
    for (const route of [
      "setup/company",
      "companies",
      ...["home", "inbox", "co-worker", "owners", "members"].map(
        (section) => `companies/${MOCK_COMPANY_A_ID}/${section}`,
      ),
    ]) {
      await page.goto(`/${locale}/${route}`);
      await checkPage(page, titles);
    }
    expect(titles.size).toBe(10);
  });
  test(`AC-11 ${locale} sign-in and home meet accessibility in dark theme`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("aqarak-theme", "dark");
    });
    await page.goto(`/${locale}/sign-in`);
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await checkPage(page, new Set());
    await signIn(page, "manager-1", locale);
    await checkPage(page, new Set());
  });
}
