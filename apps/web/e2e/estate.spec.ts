import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";
import { MOCK_COMPANY_A_ID } from "../src/lib/api/mock-fixtures";
import enOwners from "../../../packages/i18n/messages/en/Owners.json" with { type: "json" };
import arOwners from "../../../packages/i18n/messages/ar/Owners.json" with { type: "json" };
import enProperties from "../../../packages/i18n/messages/en/Properties.json" with { type: "json" };
import arProperties from "../../../packages/i18n/messages/ar/Properties.json" with { type: "json" };
import enUnits from "../../../packages/i18n/messages/en/Units.json" with { type: "json" };
import arUnits from "../../../packages/i18n/messages/ar/Units.json" with { type: "json" };
import enCommon from "../../../packages/i18n/messages/en/Common.json" with { type: "json" };
import arCommon from "../../../packages/i18n/messages/ar/Common.json" with { type: "json" };
import enStatus from "../../../packages/i18n/messages/en/Status.json" with { type: "json" };
import arStatus from "../../../packages/i18n/messages/ar/Status.json" with { type: "json" };

async function checkAccessibility(page: Page, surface: string): Promise<void> {
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  expect(
    await page
      .locator('button[data-variant="default"], a[data-variant="default"]')
      .count(),
  ).toBeLessThanOrEqual(1);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const violations = results.violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  await test.info().attach(surface, {
    body: JSON.stringify({ surface, violations }),
    contentType: "application/json",
  });
  expect(violations, surface).toEqual([]);
}

for (const locale of ["en", "ar"] as const) {
  test(`AC-7 ${locale} manager completes the bilingual estate journey`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const owners = locale === "ar" ? arOwners : enOwners;
    const properties = locale === "ar" ? arProperties : enProperties;
    const units = locale === "ar" ? arUnits : enUnits;
    const common = locale === "ar" ? arCommon : enCommon;
    const status = locale === "ar" ? arStatus : enStatus;
    const ownerName = locale === "ar" ? "مالك تجريبي" : "Synthetic Owner J2";
    const propertyName =
      locale === "ar" ? "مبنى تجريبي" : "Synthetic Residence J2";
    const base = `/${locale}/companies/${MOCK_COMPANY_A_ID}`;
    await signIn(page, "manager-1", locale);
    await page.goto(`${base}/owners`);
    await expect(page.locator("html")).toHaveAttribute(
      "dir",
      locale === "ar" ? "rtl" : "ltr",
    );
    await expect(
      page.getByRole("heading", { level: 1, name: owners.title }),
    ).toBeVisible();
    await checkAccessibility(page, "owners-list");

    await page.getByRole("button", { name: owners.add, exact: true }).click();
    await page.getByLabel(owners.fullNameEn).fill("Synthetic Owner J2");
    await page.getByLabel(owners.fullNameAr).fill("مالك تجريبي");
    await page.getByRole("button", { name: owners.add, exact: true }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: ownerName }),
    ).toBeVisible();
    const ownerId = new URL(page.url()).pathname.split("/").at(-1);
    if (!ownerId) throw new Error("Missing created synthetic owner id");
    await checkAccessibility(page, "owner-record");

    await page.getByRole("link", { name: owners.recordMandate }).click();
    await page.getByLabel(owners.gateOff).check();
    await page.getByLabel(owners.costThresholdAed).fill("2,000");
    await page.getByLabel(owners.fee).fill("5");
    await page.getByLabel(owners.startsOn).fill("2026-09-28");
    await page
      .getByRole("button", { name: owners.continue, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name: owners.checkAnswers }),
    ).toBeVisible();
    await expect(
      page.getByText(owners.effectOff, { exact: true }),
    ).toBeVisible();
    await checkAccessibility(page, "mandate-check-answers");
    await page.getByRole("button", { name: owners.saveMandate }).click();
    await expect(
      page.getByText(owners.mandateSaved, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(owners.gate.offChosen, { exact: true }).first(),
    ).toBeVisible();

    await page.goto(`${base}/properties/new`);
    await page.getByLabel(properties.fullNameEn).fill("Synthetic Residence J2");
    await page.getByLabel(properties.fullNameAr).fill("مبنى تجريبي");
    await page
      .getByLabel(properties.owner, { exact: true })
      .selectOption(ownerId);
    await page
      .getByRole("button", { name: properties.add, exact: true })
      .click();
    const upload = page.getByRole("dialog");
    await expect(upload).toBeVisible();
    await upload
      .getByRole("button", { name: common.close, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name: propertyName }),
    ).toBeVisible();
    await expect(
      page.getByText(
        properties.approvalLine
          .replace("{value}", properties.off)
          .replace("{source}", properties.sources.mandate),
        { exact: true },
      ),
    ).toBeVisible();
    await checkAccessibility(page, "property-page");

    await page
      .getByRole("link", { name: properties.addUnits, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name: units.title }),
    ).toBeVisible();
    await page.getByLabel(units.unitNo, { exact: true }).fill("201");
    await page.getByRole("button", { name: units.addRow, exact: true }).click();
    await page.getByLabel(units.unitNo, { exact: true }).nth(1).fill("202");
    await checkAccessibility(page, "add-units-page");
    await page.getByRole("button", { name: units.submit, exact: true }).click();
    const row201 = page
      .getByRole("row")
      .filter({ has: page.getByText("201", { exact: true }) });
    const row202 = page
      .getByRole("row")
      .filter({ has: page.getByText("202", { exact: true }) });
    await expect(row201).toBeVisible();
    await expect(row202).toBeVisible();
    await expect(
      row202.getByText(status.unit.vacant, { exact: true }),
    ).toBeVisible();
    await row202
      .getByRole("button", {
        name: units.actionsFor.replace("{number}", "202"),
      })
      .click();
    await page
      .getByRole("menuitem", { name: units.changeStatus, exact: true })
      .click();
    const statusDialog = page.getByRole("dialog", { name: units.changeStatus });
    await statusDialog
      .getByRole("combobox", { name: units.changeStatus })
      .selectOption("block");
    await statusDialog
      .getByLabel(units.blockReason, { exact: true })
      .selectOption("owner_use");
    const reason =
      locale === "ar"
        ? "حجب تجريبي لاستخدام المالك"
        : "Synthetic block for owner use";
    await statusDialog.getByLabel(units.reason, { exact: true }).fill(reason);
    await statusDialog
      .getByRole("button", { name: units.save, exact: true })
      .click();
    await expect(statusDialog).not.toBeVisible();
    await expect(
      row202.getByText(status.unit.blocked, { exact: true }),
    ).toBeVisible();
    await expect(
      row202.getByText(units.blockReasons.owner_use, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(reason, { exact: true })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute(
      "dir",
      locale === "ar" ? "rtl" : "ltr",
    );
  });
}
