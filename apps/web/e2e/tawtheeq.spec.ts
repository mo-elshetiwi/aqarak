import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { Locale } from "@aqarak/i18n";
import en from "../../../packages/i18n/messages/en/Tawtheeq.json" with { type: "json" };
import ar from "../../../packages/i18n/messages/ar/Tawtheeq.json" with { type: "json" };
import { MOCK_COMPANY_A_ID } from "../src/lib/api/mock-fixtures";
import { signIn } from "./helpers";
const ids = {
  awaiting: "65000000-0000-4000-8000-000000000001",
  differences: "65000000-0000-4000-8000-000000000003",
  identity: "65000000-0000-4000-8000-000000000004",
};
function base(locale: Locale): string {
  return `/${locale}/companies/${MOCK_COMPANY_A_ID}/tawtheeq`;
}
async function accessibility(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    result.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
}
for (const locale of ["en", "ar"] as const) {
  const t = locale === "en" ? en : ar;
  test(`AC-5 ${locale}: board, comparison, adoption and accessibility`, async ({
    page,
  }, testInfo) => {
    await signIn(page, "manager-1", locale);
    await page.goto(base(locale));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.title);
    await expect(
      page.getByRole("link", { name: "C-TW-03", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: "C-TW-03" }),
    ).toContainText(t.days.replace("{count}", "6"));
    await accessibility(page);
    await page.getByRole("link", { name: "C-TW-03", exact: true }).click();
    const rent = page.locator('tr[data-field="annual_rent_fils"]');
    await expect(rent).toContainText(t.classes.material);
    await expect(
      rent.getByRole("option", { name: t.mark_equivalent }),
    ).toBeDisabled();
    await expect(page.locator("tbody tr").first()).toHaveAttribute(
      "data-field",
      "annual_rent_fils",
    );
    await expect(
      page.getByTestId("source-viewer").locator("img"),
    ).toBeVisible();
    await expect
      .poll(() =>
        page
          .getByTestId("source-viewer")
          .locator("img")
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0);
    await accessibility(page);
    await page.screenshot({
      path: testInfo.outputPath(`comparison-${locale}.png`),
      fullPage: true,
    });
    await rent.getByRole("combobox").selectOption("adopt");
    await rent
      .getByRole("textbox")
      .fill(
        locale === "en"
          ? "Synthetic registered amount confirmed with the owner."
          : "تم تأكيد المبلغ الاصطناعي المسجّل مع المالك.",
      );
    await expect(page.getByTestId("consequence-annual_rent_fils")).toHaveText(
      t.ownerConsequence,
    );
    const name = page.locator('tr[data-field="tenant_name"]');
    await name.getByRole("combobox").selectOption("mark_equivalent");
    await name.getByRole("combobox").last().selectOption("formatting");
    await name
      .getByRole("textbox")
      .fill(
        locale === "en"
          ? "Same synthetic name; only letter case differs."
          : "الاسم الاصطناعي نفسه؛ الاختلاف في تنسيق الحروف فقط.",
      );
    await page
      .getByRole("button", {
        name: t.resolve.replace("{count}", "2"),
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", { name: t.adoptionTitle }),
    ).toBeVisible();
    await expect(
      page.getByText(t.ownerConsequence, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(t.currentVersion.replace("{version}", "1"), {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page
        .locator('[data-tone="attention"]')
        .filter({ hasText: locale === "en" ? /owner/i : /المالك/ })
        .first(),
    ).toBeVisible();
    await accessibility(page);
    await page.screenshot({
      path: testInfo.outputPath(`adoption-${locale}.png`),
      fullPage: true,
    });
  });
  test(`AC-6 ${locale}: uploads a synthetic PNG directly and confirms extraction`, async ({
    page,
  }) => {
    await signIn(page, "manager-1", locale);
    await page.goto(`${base(locale)}/${ids.awaiting}`);
    const png = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 960;
      canvas.height = 720;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.fillStyle = "white";
      context.fillRect(0, 0, 960, 720);
      context.fillStyle = "black";
      context.font = "24px sans-serif";
      const lines = [
        "SYNTHETIC TAWTHEEQ C-TW-01",
        "SYNTHETIC-C-TW-01 | 2026-09-28",
        "UNT-SYNTHETIC-107",
        "Khalid Al Suwaidi (synthetic)",
        "784-0000-0000001-1",
        "Omar Farouk (synthetic)",
        "784-0000-0000002-2",
        "2026-10-01 to 2027-09-30",
        "70000.00 AED | Deposit 3500.00 AED",
        "RESIDENTIAL",
      ];
      lines.forEach((line, index) => {
        context.fillText(line, 36, 60 + index * 56);
      });
      return canvas.toDataURL("image/png").split(",")[1];
    });
    if (!png) throw new Error("Missing synthetic PNG");
    await page.getByLabel(t.uploadLabel, { exact: true }).setInputFiles({
      name: "synthetic-tawtheeq.png",
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    });
    const put = page.waitForResponse(
      (r) => r.request().method() === "PUT" && r.url().includes("mock-storage"),
    );
    await page.getByRole("button", { name: t.upload, exact: true }).click();
    expect((await put).status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: t.reviewTitle, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(t.notCalibrated, { exact: true })).toHaveCount(
      12,
    );
    await expect(
      page.getByTestId("source-viewer").locator("img"),
    ).toBeVisible();
    await expect
      .poll(() =>
        page
          .getByTestId("source-viewer")
          .locator("img")
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0);
    const submit = page.getByRole("button", {
      name: t.reviewSubmit,
      exact: true,
    });
    await expect(submit).toBeDisabled();
    for (const key of [
      "tawtheeq_number",
      "registered_on",
      "unt_number",
      "owner_id_number",
      "tenant_id_number",
    ] as const) {
      await page.getByTestId(`review-${key}`).getByRole("checkbox").check();
    }
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(
      page.getByText(t.registeredSuccess, { exact: true }),
    ).toBeVisible();
    await accessibility(page);
  });
  for (const handle of ["owner-1", "technician-1"])
    test(`AC-7 ${locale}: ${handle} cannot open the board or a record without a pending owner decision`, async ({
      page,
    }) => {
      await signIn(page, handle, locale);
      await page.goto(base(locale));
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        t.notPermitted,
      );
      await expect(
        page.getByRole("link", { name: "C-TW-03", exact: true }),
      ).toHaveCount(0);
      await page.goto(`${base(locale)}/${ids.identity}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        t.notPermitted,
      );
    });
}
test("board distinguishes no matches and offline; identity rejection offers replacement", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(base("en"));
  await page.getByLabel(en.filter, { exact: true }).selectOption("closed");
  await expect(page.getByText(en.noMatches, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: en.clearFilters }).click();
  await expect(
    page.getByRole("link", { name: "C-TW-04", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "C-TW-04", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: en.identityTitle }),
  ).toBeVisible();
  await expect(page.getByTestId("source-viewer").locator("img")).toBeVisible();
  await expect(
    page.getByText("784-0000-0000099-9", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: en.replaceUpload, exact: true }),
  ).toBeVisible();
  await page.context().setOffline(true);
  await expect(page.getByText(en.offline, { exact: true })).toBeVisible();
  await page.context().setOffline(false);
});

async function adoptRent(page: Page, locale: Locale): Promise<void> {
  const t = locale === "en" ? en : ar;
  await page.goto(`${base(locale)}/${ids.differences}`);
  const rent = page.locator('tr[data-field="annual_rent_fils"]');
  await rent.getByRole("combobox").selectOption("adopt");
  await rent
    .getByRole("textbox")
    .fill("Synthetic adopted rent for owner decision");
  const name = page.locator('tr[data-field="tenant_name"]');
  await name.getByRole("combobox").first().selectOption("mark_equivalent");
  await name.getByRole("combobox").last().selectOption("formatting");
  await name.getByRole("textbox").fill("Synthetic equivalent name");
  await page
    .getByRole("button", {
      name: t.resolve.replace("{count}", "2"),
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: t.adoptionTitle }),
  ).toBeVisible();
}
for (const locale of ["en", "ar"] as const) {
  const t = locale === "en" ? en : ar;
  test(`AC-4 ${locale}: history shows covering events and workflow diffs after resolution`, async ({
    page,
  }) => {
    await signIn(page, "manager-1", locale);
    await adoptRent(page, locale);
    await page.getByRole("link", { name: t.history, exact: true }).click();
    await expect(page.getByTestId("history-version")).toHaveCount(2);
    const versions = page.getByTestId("history-version");
    await expect(versions.first()).toContainText("tawtheeq.created");
    await expect(versions.last()).toContainText("tawtheeq.resolutions");
    const diff = versions.last().locator('tr[data-field="workflow_state"]');
    await expect(diff).toContainText(t.states.discrepancies_open);
    await expect(diff).toContainText(t.states.awaiting_owner_reapproval);
    await accessibility(page);
    await page.getByRole("link", { name: t.overview, exact: true }).click();
    await page
      .getByRole("link", { name: t.contractHistory, exact: true })
      .last()
      .click();
    await expect(page.getByTestId("history-version")).toHaveCount(1);
    await expect(
      page.locator('tr[data-field="annual_rent_fils"]'),
    ).toBeVisible();
  });
  test(`AC-5 ${locale}: skip requires a reason, focuses the summary and saves Skipped`, async ({
    page,
  }) => {
    await signIn(page, "manager-1", locale);
    await page.goto(`${base(locale)}/${ids.awaiting}`);
    await page.getByText(t.actions, { exact: true }).click();
    await page.getByRole("button", { name: t.skip, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByText(t.skipWarning, { exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: t.skipConfirm }).click();
    await expect(dialog.getByRole("alert")).toBeFocused();
    await expect(dialog.getByRole("alert")).toContainText(t.reason);
    await dialog
      .getByLabel(t.reason, { exact: true })
      .fill("Synthetic registration deferred by manager");
    await accessibility(page);
    await dialog.getByRole("button", { name: t.skipConfirm }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("span[data-tone]")).toContainText(
      t.states.skipped,
    );
    await expect(
      page.getByText("Synthetic registration deferred by manager", {
        exact: true,
      }),
    ).toBeVisible();
  });
  test(`AC-6 ${locale}: named owner sees prior and adopted values and approves in own session`, async ({
    page,
    browser,
    baseURL,
  }) => {
    await signIn(page, "manager-1", locale);
    await adoptRent(page, locale);
    if (!baseURL) throw new Error("Missing test base URL");
    const ownerContext = await browser.newContext({ baseURL });
    const owner = await ownerContext.newPage();
    await signIn(owner, "owner-1", locale);
    await owner.goto(`${base(locale)}/${ids.differences}`);
    await expect(
      owner.getByRole("heading", { name: t.ownerDecisionTitle }),
    ).toBeVisible();
    const row = owner
      .getByRole("row")
      .filter({ hasText: t.fields.annual_rent_fils });
    await expect(row.locator('[data-slot="money-amount"]')).toHaveCount(2);
    const values = await row
      .locator('[data-slot="money-amount"]')
      .allTextContents();
    expect(values[0]).not.toBe(values[1]);
    await expect(
      owner.getByText(t.ownerDecisionConsequence, { exact: true }),
    ).toBeVisible();
    await expect(
      owner.getByRole("link", { name: t.history, exact: true }),
    ).toHaveCount(0);
    await owner.getByRole("button", { name: t.return, exact: true }).click();
    await expect(owner.getByRole("main").getByRole("alert")).toBeFocused();
    await expect(owner.getByRole("main").getByRole("alert")).toContainText(
      t.reason,
    );
    await accessibility(owner);
    await owner.getByRole("button", { name: t.approve, exact: true }).click();
    await expect(
      owner.getByText(t.ownerDecisionSaved, { exact: true }),
    ).toBeVisible();
    await expect(owner.locator("span[data-tone]")).toContainText(
      t.states.registered,
    );
    await page.reload();
    await expect(
      page.getByText(t.registeredSuccess, { exact: true }),
    ).toBeVisible();
    await ownerContext.close();
  });
  test(`${locale}: gated skip stays pending and party history is not permitted`, async ({
    page,
  }) => {
    await signIn(page, "manager-1", locale);
    await page.goto(`${base(locale)}/${ids.identity}`);
    await page.getByText(t.actions, { exact: true }).click();
    await page.getByRole("button", { name: t.skip, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel(t.reason, { exact: true })
      .fill("Synthetic gated skip request");
    await dialog
      .getByRole("button", { name: t.requestSkipConfirmation })
      .click();
    await expect(page.getByText(t.skipPending, { exact: true })).toBeVisible();
    await page.context().clearCookies();
    await signIn(page, "owner-1", locale);
    await page.goto(`${base(locale)}/${ids.identity}?tab=history`);
    await expect(
      page.getByText(t.historyNotPermitted, { exact: true }),
    ).toBeVisible();
  });
}

for (const locale of ["en", "ar"] as const) {
  const t = locale === "en" ? en : ar;
  test(`AC-6 ${locale}: owner returns adopted rent with a recorded reason`, async ({
    page,
    browser,
    baseURL,
  }) => {
    await signIn(page, "manager-1", locale);
    await adoptRent(page, locale);
    if (!baseURL) throw new Error("Missing test base URL");
    const ownerContext = await browser.newContext({ baseURL });
    const owner = await ownerContext.newPage();
    await signIn(owner, "owner-1", locale);
    await owner.goto(`${base(locale)}/${ids.differences}`);
    await owner
      .getByLabel(t.reason, { exact: true })
      .fill("Synthetic owner requests correction");
    await owner.getByRole("button", { name: t.return, exact: true }).click();
    await expect(
      owner.getByText(t.ownerDecisionSaved, { exact: true }),
    ).toBeVisible();
    await expect(owner.locator("span[data-tone]")).toContainText(
      t.states.awaiting_registration,
    );
    await page.reload();
    await expect(
      page.getByText("Synthetic owner requests correction", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(t.currentVersion.replace("{version}", "1"), {
        exact: true,
      }),
    ).toBeVisible();
    await ownerContext.close();
  });
}

for (const locale of ["en", "ar"] as const) {
  const t = locale === "en" ? en : ar;
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMioAAAAASUVORK5CYII=",
    "base64",
  );
  test(`${locale}: pending scan retries completion and opens review`, async ({
    page,
  }) => {
    await signIn(page, "manager-1", locale);
    await page.goto(`${base(locale)}/${ids.awaiting}`);
    let uploads = 0;
    page.on("request", (request) => {
      if (request.method() === "PUT" && request.url().includes("mock-storage"))
        uploads += 1;
    });
    await page.getByLabel(t.uploadLabel, { exact: true }).setInputFiles({
      name: "synthetic-pending.png",
      mimeType: "image/png",
      buffer: png,
    });
    await page.getByRole("button", { name: t.upload, exact: true }).click();
    await expect(
      page.getByText(t.scanInProgress, { exact: true }),
    ).toBeVisible();
    await expect(page.locator("span[data-tone]")).toContainText(
      t.states.awaiting_registration,
    );
    await expect(
      page.getByLabel(t.uploadLabel, { exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("heading", { name: t.reviewTitle, exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("span[data-tone]")).toContainText(
      t.states.under_review,
    );
    expect(uploads).toBe(1);
  });
  test(`${locale}: rejected scan preserves the header and accepts a new upload`, async ({
    page,
  }) => {
    await signIn(page, "manager-1", locale);
    await page.goto(`${base(locale)}/${ids.awaiting}`);
    const heading = await page.getByRole("heading", { level: 1 }).innerText();
    await page.getByLabel(t.uploadLabel, { exact: true }).setInputFiles({
      name: "synthetic-rejected.png",
      mimeType: "image/png",
      buffer: Buffer.from("synthetic invalid signature"),
    });
    await page.getByRole("button", { name: t.upload, exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: t.scanRejected }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    await expect(page.locator("span[data-tone]")).toContainText(
      t.states.awaiting_registration,
    );
    await expect(page.getByLabel(t.uploadLabel, { exact: true })).toHaveValue(
      "",
    );
    await page.getByLabel(t.uploadLabel, { exact: true }).setInputFiles({
      name: "synthetic-clean.png",
      mimeType: "image/png",
      buffer: png,
    });
    await page
      .getByRole("button", { name: t.replaceUpload, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: t.reviewTitle, exact: true }),
    ).toBeVisible();
  });
}
