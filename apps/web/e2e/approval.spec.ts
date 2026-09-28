import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
for (const locale of ["en", "ar"] as const) {
  for (const theme of ["light", "dark"])
    test(`${locale} approval in ${theme} meets accessibility and page contracts`, async ({
      page,
    }) => {
      await page.addInitScript((value) => {
        localStorage.setItem("aqarak-theme", value);
      }, theme);
      await page.goto(`/${locale}/showcase/approval`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 2 })).toHaveCount(4);
      await expect(page.locator('button[data-variant="default"]')).toHaveCount(
        0,
      );
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        "content",
        /noindex/,
      );
      await expect(page.locator("ol").nth(0).locator("li")).toHaveCount(3);
      await expect(page.locator("ol").nth(1).locator("li")).toHaveCount(2);
      await expect(
        page.locator("ol").nth(1).locator('[data-slot="owner"]'),
      ).toHaveCount(0);
      await expect(
        page.locator("ol").first().locator('[aria-current="step"]'),
      ).toHaveAttribute("data-slot", "owner");
      await expect(page.locator("ol").first()).toContainText(
        locale === "en"
          ? "Waiting for Khalid Al Suwaidi (owner) · 2 days"
          : "بانتظار خالد السويدي (المالك) · منذ يومين",
      );
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
  test(`${locale} timeline follows reading order and stacks on mobile`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${locale}/showcase/approval`);
    const items = page.locator("ol").first().locator("li");
    const manager = await items.nth(0).boundingBox();
    const owner = await items.nth(1).boundingBox();
    if (!manager || !owner) throw new Error("Missing timeline bounds");
    expect(locale === "ar" ? manager.x > owner.x : manager.x < owner.x).toBe(
      true,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileManager = await items.nth(0).boundingBox();
    const mobileOwner = await items.nth(1).boundingBox();
    if (!mobileManager || !mobileOwner)
      throw new Error("Missing mobile timeline bounds");
    expect(mobileManager.y + mobileManager.height).toBeLessThan(mobileOwner.y);
  });
}
