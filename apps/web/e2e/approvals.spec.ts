import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { Locale } from "@aqarak/i18n";
import enContracts from "../../../packages/i18n/messages/en/Contracts.json" with { type: "json" };
import arContracts from "../../../packages/i18n/messages/ar/Contracts.json" with { type: "json" };
import enApprovals from "../../../packages/i18n/messages/en/Approvals.json" with { type: "json" };
import arApprovals from "../../../packages/i18n/messages/ar/Approvals.json" with { type: "json" };
import enStatus from "../../../packages/i18n/messages/en/Status.json" with { type: "json" };
import arStatus from "../../../packages/i18n/messages/ar/Status.json" with { type: "json" };
import {
  MOCK_COMPANY_A_ID,
  MOCK_COMPANY_B_ID,
} from "../src/lib/api/mock-fixtures";
import { signIn } from "./helpers";
function messages(locale: Locale): {
  c: typeof enContracts;
  a: typeof enApprovals;
  s: typeof enStatus;
} {
  return locale === "en"
    ? { c: enContracts, a: enApprovals, s: enStatus }
    : { c: arContracts, a: arApprovals, s: arStatus };
}
function companyBase(locale: Locale): string {
  return `/${locale}/companies/${MOCK_COMPANY_A_ID}`;
}
async function accessible(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    result.violations.filter(
      (item) => item.impact === "serious" || item.impact === "critical",
    ),
  ).toEqual([]);
  expect(await page.locator("main").innerText()).not.toMatch(/[٠-٩]/);
}
async function confirm(page: Page, locale: Locale): Promise<void> {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: messages(locale).a.confirm, exact: true })
    .click();
}
async function createDraft(
  page: Page,
  locale: Locale,
  year: number,
): Promise<string> {
  const { c } = messages(locale);
  await page.goto(`${companyBase(locale)}/contracts/new`);
  await page
    .locator("#unitId")
    .selectOption("50000000-0000-4000-8000-000000000002");
  await page
    .locator("#tenantId")
    .selectOption("30000000-0000-4000-8000-000000000002");
  await page.locator("#termStart").fill(`${String(year)}-10-01`);
  await page.locator("#termEnd").fill(`${String(year + 1)}-09-30`);
  await page.getByRole("button", { name: c.split, exact: true }).click();
  for (let index = 0; index < 4; index++) {
    await page
      .locator(`#instalments-${String(index)}-dueOn`)
      .fill(`${String(year)}-10-01`);
    await page
      .locator(`#instalments-${String(index)}-cheque-chequeNo`)
      .fill(`20${String(index)}`);
    await page
      .locator(`#instalments-${String(index)}-cheque-bankName`)
      .fill("Synthetic Bank");
  }
  await page
    .locator("#specialClauses-0-textEn")
    .fill("Keep the balcony clear.");
  await page
    .locator("#specialClauses-0-textAr")
    .fill("يلتزم المستأجر بإبقاء الشرفة خالية.");
  await page.getByRole("button", { name: c.saveDraft, exact: true }).click();
  await expect(page).toHaveURL(/\/contracts\/[a-f0-9-]{36}$/);
  return new URL(page.url()).pathname;
}
async function submit(page: Page, locale: Locale): Promise<void> {
  const { a, s } = messages(locale);
  await page.getByRole("button", { name: a.submit, exact: true }).click();
  await confirm(page, locale);
  await expect(
    page.getByText(s.contract.awaiting_owner_approval, { exact: true }),
  ).toBeVisible();
}
async function useSuggestion(page: Page, locale: Locale): Promise<void> {
  const { c } = messages(locale);
  const arabic = page.locator("#specialClauses-0-textAr");
  const existing = await arabic.inputValue();
  await page.locator("#specialClauses-0-textEn").fill("unavailable");
  await page
    .getByRole("button", { name: c.suggestion.request, exact: true })
    .click();
  await expect(page.locator("main").getByRole("alert")).toHaveText(
    c.errors.MODEL_UNAVAILABLE,
  );
  await expect(arabic).toHaveValue(existing);
  await page
    .locator("#specialClauses-0-textEn")
    .fill("Keep the balcony clear.");
  await page
    .getByRole("button", { name: c.suggestion.request, exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: c.suggestion.use, exact: true }),
  ).toBeVisible();
  await expect(arabic).toHaveValue(existing);
  await page
    .getByRole("button", { name: c.suggestion.label, exact: true })
    .click();
  await expect(
    page.getByText("synthetic-clause-translation", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(c.suggestion.time, { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: c.suggestion.close, exact: true })
    .click();
  await page
    .getByRole("button", { name: c.suggestion.use, exact: true })
    .click();
  await expect(arabic).toHaveValue(c.suggestion.synthetic);
  await arabic.fill(`${c.suggestion.synthetic} وفقًا للعقد.`);
}
async function expectRentChange(page: Page, locale: Locale): Promise<void> {
  const { c } = messages(locale);
  const changes = page.getByRole("table", {
    name: new RegExp(c.changes.title.split("{number}")[0] ?? ""),
  });
  const rent = changes.getByRole("row", { name: new RegExp(c.rent) });
  await expect(rent).toContainText("85,000.00");
  await expect(rent).toContainText("90,000.00");
}
for (const locale of ["en", "ar"] as const) {
  test(`${locale} returns, revises and reviews changed terms from the approvals queue`, async ({
    page,
    browser,
  }) => {
    const { c, a, s } = messages(locale);
    await signIn(page, "manager-1", locale);
    const original = await createDraft(
      page,
      locale,
      locale === "en" ? 2030 : 2032,
    );
    await submit(page, locale);
    await expect(
      page.getByText(c.delivery.addressUnverified, { exact: true }),
    ).toBeVisible();
    const ownerContext = await browser.newContext();
    const tenantContext = await browser.newContext();
    try {
      const owner = await ownerContext.newPage();
      await signIn(owner, "owner-1", locale);
      await owner.goto(original);
      await expect(
        owner.getByRole("heading", { name: c.delivery.title }),
      ).toHaveCount(0);
      await owner
        .getByRole("button", { name: a.return_owner, exact: true })
        .click();
      const reason =
        locale === "en"
          ? "Please revise the annual rent."
          : "يرجى تعديل الإيجار السنوي.";
      await owner
        .getByRole("dialog")
        .getByRole("textbox", { name: a.reason, exact: true })
        .fill(reason);
      await confirm(owner, locale);
      await expect(
        owner.getByText(s.contract.cancelled, { exact: true }),
      ).toBeVisible();
      await page.reload();
      await expect(
        page.getByText(s.contract.cancelled, { exact: true }),
      ).toBeVisible();
      await expect(page.getByText(reason, { exact: true })).toBeVisible();
      await page.getByRole("button", { name: a.revise, exact: true }).click();
      await expect(page.getByRole("dialog")).toContainText(a.reviseEffect);
      await confirm(page, locale);
      await expect(page).not.toHaveURL(new RegExp(`${original}$`));
      await expect(
        page.getByText(c.changes.none, { exact: true }),
      ).toBeVisible();
      const title = await page.getByRole("heading", { level: 1 }).innerText();
      const number = /SYN-\d+/.exec(title)?.[0];
      if (!number) throw new Error("Missing synthetic contract number");
      await page.locator("#annualRentFils").fill("90000");
      await page.locator("#totalFils").fill("90000");
      await page.getByRole("button", { name: c.split, exact: true }).click();
      await useSuggestion(page, locale);
      await page
        .getByRole("button", { name: c.saveChanges, exact: true })
        .click();
      await expect(page.locator('bdi[data-kind="prp"]').first()).toContainText(
        "2",
      );
      await expectRentChange(page, locale);
      await expect(page.locator('article[lang="ar"]')).toContainText(
        `${c.suggestion.synthetic} وفقًا للعقد.`,
      );
      await page.reload();
      await expect(
        page.getByText("synthetic-clause-translation", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(new RegExp(c.suggestion.edited)),
      ).toBeVisible();
      await submit(page, locale);
      await owner.goto(`${companyBase(locale)}/approvals`);
      await expect(
        owner
          .getByRole("table", { name: a.title, exact: true })
          .getByRole("link", { name: number, exact: true }),
      ).toBeVisible();
      await expect(
        owner.locator('main button[data-variant="default"]'),
      ).toHaveCount(0);
      await accessible(owner);
      await owner.screenshot({
        path: test.info().outputPath(`${locale}-approvals.png`),
        fullPage: true,
      });
      const unread = owner.getByRole("button", {
        name: a.markRead,
        exact: true,
      });
      const count = await unread.count();
      await unread.first().click();
      await expect(unread).toHaveCount(count - 1);
      await owner.getByRole("link", { name: number, exact: true }).click();
      await expectRentChange(owner, locale);
      await accessible(owner);
      await owner.screenshot({
        path: test.info().outputPath(`${locale}-revision.png`),
        fullPage: true,
      });
      await owner
        .getByRole("button", {
          name: a.approve_owner.replace("{version}", "2"),
          exact: true,
        })
        .click();
      await confirm(owner, locale);
      await expect(
        owner.getByText(s.contract.awaiting_tenant_acceptance, { exact: true }),
      ).toBeVisible();
      const tenant = await tenantContext.newPage();
      await signIn(tenant, "tenant-1", locale);
      await tenant.goto(`${companyBase(locale)}/approvals`);
      await tenant.getByRole("link", { name: number, exact: true }).click();
      await expectRentChange(tenant, locale);
      await expect(
        tenant.getByRole("heading", { name: c.delivery.title }),
      ).toHaveCount(0);
      await accessible(tenant);
    } finally {
      await ownerContext.close();
      await tenantContext.close();
    }
  });
  test(`${locale} shows an empty personal queue in a linked company without contracts`, async ({
    page,
  }) => {
    await signIn(page, "owner-2", locale);
    await page.goto(`/${locale}/companies/${MOCK_COMPANY_B_ID}/approvals`);
    await expect(
      page.getByText(messages(locale).a.empty, { exact: true }),
    ).toBeVisible();
    await accessible(page);
  });
}
test("a stale draft keeps the manager's entered rent", async ({ page }) => {
  await signIn(page);
  const path = await createDraft(page, "en", 2040);
  const second = await page.context().newPage();
  try {
    await second.goto(path);
    await second.locator("#graceDays").fill("4");
    await second
      .getByRole("button", { name: enContracts.saveChanges, exact: true })
      .click();
    await expect(second.locator('bdi[data-kind="prp"]').first()).toContainText(
      "v2",
    );
    await page.locator("#annualRentFils").fill("99000");
    await page
      .getByRole("button", { name: enContracts.saveChanges, exact: true })
      .click();
    await expect(page.locator("main").getByRole("alert")).toContainText(
      enContracts.errors.VERSION_CONFLICT,
    );
    await expect(page.locator("#annualRentFils")).toHaveValue("99000");
  } finally {
    await second.close();
  }
});
