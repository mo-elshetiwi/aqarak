import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
for (const locale of ["en", "ar"] as const) {
  for (const theme of ["light", "dark"])
    test(`${locale} review in ${theme} meets accessibility and page contracts`, async ({
      page,
    }) => {
      await page.addInitScript((value) => {
        localStorage.setItem("aqarak-theme", value);
      }, theme);
      await page.goto(`/${locale}/showcase/review`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.locator('button[data-variant="default"]')).toHaveCount(
        1,
      );
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        "content",
        /noindex/,
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
  test(`${locale} source layout, source check, zoom and keyboard controls`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${locale}/showcase/review`);
    const source = page.getByTestId("source-viewer");
    const fields = page.getByTestId("fields-pane");
    const sourceBox = await source.boundingBox();
    const fieldsBox = await fields.boundingBox();
    if (!sourceBox || !fieldsBox) throw new Error("Missing review pane bounds");
    expect(
      locale === "ar" ? sourceBox.x > fieldsBox.x : sourceBox.x < fieldsBox.x,
    ).toBe(true);
    expect(sourceBox.width / (sourceBox.width + fieldsBox.width)).toBeCloseTo(
      0.55,
      2,
    );
    const image = source.locator("img");
    expect(
      await image.evaluate((element) => getComputedStyle(element).transform),
    ).toBe("none");
    expect(
      await image
        .locator("..")
        .evaluate((element) => getComputedStyle(element).transform),
    ).not.toContain("matrix(-1");
    const id = page.getByTestId("field-identityNumber");
    const accept = id.getByRole("button", {
      name: locale === "en" ? "Accept ID number" : "قبول رقم الهوية",
      exact: true,
    });
    await expect(accept).toBeDisabled();
    await expect(accept).toHaveAccessibleDescription(
      locale === "en" ? "Open the source first" : "افتح المصدر أولاً",
    );
    const view = id.getByRole("button", {
      name:
        locale === "en" ? "View source for ID number" : "عرض مصدر رقم الهوية",
    });
    await view.focus();
    await page.keyboard.press("Enter");
    await expect(source.getByTestId("source-region")).toBeVisible();
    await expect(accept).toBeEnabled();
    await expect(source.getByTestId("source-region")).toHaveCSS(
      "outline-width",
      "2px",
    );
    const viewport = source.getByRole("region");
    await viewport.focus();
    await page.keyboard.press("+");
    await page.keyboard.press("+");
    await page.keyboard.press("-");
    await expect(page.getByTestId("zoom-level")).toHaveText(
      locale === "en" ? "Zoom 125%" : "التكبير 125٪",
    );
    await expect(page.getByTestId("zoom-level")).toHaveAttribute(
      "aria-live",
      "polite",
    );
    await expect(
      source.getByRole("button", {
        name: locale === "en" ? "Zoom in" : "تكبير",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      source.getByRole("button", {
        name: locale === "en" ? "Zoom out" : "تصغير",
        exact: true,
      }),
    ).toBeVisible();
    await page.keyboard.press("ArrowRight");
    expect(
      await viewport.evaluate((element) => element.scrollLeft),
    ).toBeGreaterThan(0);
    await source
      .getByRole("button", {
        name: locale === "en" ? "Rotate clockwise" : "تدوير مع عقارب الساعة",
      })
      .click();
    await expect(image.locator("../..")).toHaveCSS("transform", /matrix/);
    await source
      .getByRole("button", {
        name: locale === "en" ? "Reset view" : "إعادة ضبط العرض",
      })
      .click();
    await expect(page.getByTestId("zoom-level")).toHaveText(
      locale === "en" ? "Zoom 100%" : "التكبير 100٪",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileSource = await source.boundingBox();
    const mobileFields = await fields.boundingBox();
    if (!mobileSource || !mobileFields)
      throw new Error("Missing mobile pane bounds");
    expect(mobileSource.y + mobileSource.height).toBeLessThanOrEqual(
      mobileFields.y,
    );
  });
  test(`${locale} decisions, reset, language switch and provenance popover`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/showcase/review`);
    const row = page.getByTestId("field-identityNumber");
    const trigger = row.getByRole("button", {
      name: locale === "en" ? "AI suggested" : "مقترح بالذكاء الاصطناعي",
    });
    await trigger.click();
    await expect(page.getByRole("dialog")).toContainText("document-extraction");
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await row
      .getByRole("button", {
        name:
          locale === "en" ? "View source for ID number" : "عرض مصدر رقم الهوية",
      })
      .click();
    for (const [id, en, ar] of [
      ["identityNumber", "ID number", "رقم الهوية"],
      ["birthDate", "Date of birth", "تاريخ الميلاد"],
      ["expiryDate", "Expiry date", "تاريخ الانتهاء"],
    ] as const) {
      await page
        .getByTestId(`field-${id}`)
        .getByRole("button", {
          name: locale === "en" ? `Accept ${en}` : `قبول ${ar}`,
          exact: true,
        })
        .click();
    }
    const primary = page.locator('button[data-variant="default"]');
    await expect(primary).toBeEnabled();
    await primary.click();
    await expect(
      page.getByRole("status").filter({
        hasText:
          locale === "en"
            ? "Decisions ready to check"
            : "القرارات جاهزة للمراجعة",
      }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: locale === "en" ? "Discard extraction" : "تجاهل الاستخراج",
      })
      .click();
    await expect(primary).toBeDisabled();
    await expect(row).toHaveAttribute("data-state", "undecided");
    await page
      .getByRole("link", {
        name:
          locale === "en" ? "Change language العربية" : "تغيير اللغة English",
      })
      .click();
    await expect(page).toHaveURL(
      `/${locale === "en" ? "ar" : "en"}/showcase/review`,
    );
  });
}
