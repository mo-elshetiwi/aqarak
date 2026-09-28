import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
for (const locale of ["en", "ar"]) {
  for (const route of ["showcase", "showcase/states"]) {
    for (const theme of ["light", "dark"]) {
      test(`${locale}/${route} in ${theme} meets the page and accessibility contract`, async ({
        page,
      }) => {
        await page.addInitScript((value) => {
          localStorage.setItem("aqarak-theme", value);
        }, theme);
        await page.goto(`/${locale}/${route}`);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(page.locator("html")).toHaveAttribute(
          "dir",
          locale === "ar" ? "rtl" : "ltr",
        );
        await expect(page.locator("html")).toHaveClass(
          new RegExp(`\\b${theme}\\b`),
        );
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
        expect(
          await page.locator('button[data-variant="default"]').count(),
        ).toBeLessThanOrEqual(1);
        await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
          "content",
          /noindex/,
        );
        if (route === "showcase") {
          await expect(
            page.locator('[data-slot="avatar-fallback"]'),
          ).toHaveText(locale === "ar" ? "خ س" : "KS");
        }
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
  }
  test(`${locale} uses the right face, readable body metrics and tabular amounts`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/showcase`);
    await page.evaluate(() => document.fonts.ready);
    const metrics = await page
      .locator('[data-body-sample="true"]')
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          size: Number.parseFloat(style.fontSize),
          line: Number.parseFloat(style.lineHeight),
          family: style.fontFamily.split(",")[0],
        };
      });
    expect(metrics.family).toContain(
      locale === "ar" ? "IBM Plex Sans Arabic" : "IBM Plex Sans",
    );
    expect(metrics.size).toBeGreaterThanOrEqual(16);
    if (locale === "ar")
      expect(metrics.line / metrics.size).toBeGreaterThanOrEqual(1.6);
    await expect(page.locator('[data-slot="money-amount"]')).toHaveCSS(
      "font-variant-numeric",
      "tabular-nums",
    );
    const primary = page.locator('button[data-variant="default"]');
    await expect(primary).toHaveCSS(
      "font-size",
      locale === "ar" ? "15px" : "14px",
    );
    await expect(primary).toHaveCSS("height", "36px");
    await expect(primary).toHaveCSS("border-radius", "8px");
    await expect(page.locator('[data-slot="input"]').first()).toHaveCSS(
      "height",
      "36px",
    );
    await expect(page.locator('button[data-size="sm"]').first()).toHaveCSS(
      "height",
      "32px",
    );
    await expect(page.locator('button[data-size="lg"]').first()).toHaveCSS(
      "height",
      "40px",
    );
    await expect(page.locator('button[data-size="icon"]').first()).toHaveCSS(
      "width",
      "32px",
    );
  });
}
test("theme choice survives reload and system preference remains live", async ({
  page,
}) => {
  await page.goto("/en/showcase");
  await page.getByRole("radio", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await page.reload();
  await expect(
    page.getByRole("radio", { name: "Dark", exact: true }),
  ).toBeChecked();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await page.getByRole("radio", { name: "System", exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass(/\b(?:light|dark)\b/);
  await page.emulateMedia({ colorScheme: "dark" });
  const dark = await page
    .locator("body")
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  await page.emulateMedia({ colorScheme: "light" });
  const light = await page
    .locator("body")
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(dark).not.toBe(light);
});
test("motion respects the duration limits and reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/en/showcase");
  const button = page.locator('button[data-variant="default"]');
  const duration = await button.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).transitionDuration),
  );
  expect(duration).toBeGreaterThanOrEqual(0.12);
  expect(duration).toBeLessThanOrEqual(0.18);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(button).toHaveCSS("transition-duration", "0s");
});
test("language links preserve the showcase and dialogs return focus", async ({
  page,
}) => {
  await page.goto("/en/showcase");
  const trigger = page.getByRole("button", {
    name: "Open dialog",
    exact: true,
  });
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(trigger).toBeFocused();
  await page.getByRole("link", { name: "Change language العربية" }).click();
  await expect(page).toHaveURL("/ar/showcase");
});

for (const locale of ["en", "ar"] as const) {
  test(`${locale} controls, panels and keyboard direction operate with visible focus`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/showcase`);
    const checkbox = page.getByRole("checkbox");
    await checkbox.check();
    await expect(checkbox).toBeChecked();
    await checkbox.uncheck();
    await expect(checkbox).not.toBeChecked();
    const phone = page.getByRole("radio", {
      name: locale === "en" ? "Phone" : "الهاتف",
      exact: true,
    });
    await phone.check();
    await expect(phone).toBeChecked();
    const select = page.getByRole("combobox");
    await select.click();
    await page.getByRole("option", { name: "105", exact: true }).click();
    await expect(select).toHaveText("105");
    const tabs = page.getByRole("tab");
    await tabs.first().focus();
    await page.keyboard.press(locale === "ar" ? "ArrowLeft" : "ArrowRight");
    await expect(tabs.nth(1)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(tabs.nth(1)).toHaveCSS("outline-width", "2px");
    await expect(tabs.nth(1)).toHaveCSS("outline-offset", "2px");
    const sheet = page.getByRole("button", {
      name: locale === "en" ? "Open panel" : "فتح لوحة",
      exact: true,
    });
    await sheet.click();
    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    if (!box) throw new Error("Panel has no visible bounds");
    const viewport = page.viewportSize();
    if (!viewport) throw new Error("Missing viewport");
    if (locale === "ar") expect(box.x).toBe(0);
    else expect(Math.round(box.x + box.width)).toBe(viewport.width);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeFocused();
    await page
      .getByRole("button", {
        name: locale === "en" ? "Open menu" : "فتح قائمة",
        exact: true,
      })
      .click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.getByRole("menuitem").click();
    await expect(page.getByRole("menu")).not.toBeVisible();
    await page
      .getByRole("button", {
        name: locale === "en" ? "More information" : "مزيد من المعلومات",
        exact: true,
      })
      .hover();
    await expect(page.getByRole("tooltip")).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: locale === "en" ? "More information" : "مزيد من المعلومات",
        exact: true,
      }),
    ).toHaveAccessibleDescription(
      locale === "en"
        ? "Review the synthetic property details."
        : "راجع بيانات العقار التجريبية.",
    );
  });
}
