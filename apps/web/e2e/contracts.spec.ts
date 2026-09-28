import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";
import { getMessages } from "./catalogues";
import enApproval from "../../../packages/i18n/messages/en/Approval.json" with { type: "json" };
import arContracts from "../../../packages/i18n/messages/ar/Contracts.json" with { type: "json" };
import arApprovals from "../../../packages/i18n/messages/ar/Approvals.json" with { type: "json" };
import arStatus from "../../../packages/i18n/messages/ar/Status.json" with { type: "json" };
import {
  MOCK_COMPANY_A_ID,
  MOCK_COMPANY_B_ID,
} from "../src/lib/api/mock-fixtures";
const base = `/en/companies/${MOCK_COMPANY_A_ID}/contracts`;
const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
async function capture(page: Page, name: string): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await page.screenshot({ path: test.info().outputPath(name), fullPage: true });
}
async function accessible(page: Page): Promise<void> {
  await expect(page).toHaveTitle(/.+ · .+ · (Aqarak|عقارك)/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  expect(
    await page.locator('main button[data-variant="default"]').count(),
  ).toBeLessThanOrEqual(1);
  const results = await new AxeBuilder({ page }).withTags(tags).analyze();
  expect(
    results.violations.filter(
      (item) => item.impact === "serious" || item.impact === "critical",
    ),
  ).toEqual([]);
}
async function createDraft(page: Page, unit: "104" | "105"): Promise<string> {
  await page.goto(`${base}/new`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Draft a contract",
  );
  await page
    .locator("#unitId")
    .selectOption({ label: `Al Waha Residence, Building 7 · ${unit}` });
  await page.locator("#tenantId").selectOption({ label: "Omar Farouk" });
  await page.locator("#termStart").fill("2026-10-01");
  await page.locator("#termEnd").fill("2027-09-30");
  await page.locator("#annualRentFils").fill("85000");
  await page.locator("#totalFils").fill("85000");
  await page.getByRole("button", { name: "Split evenly" }).click();
  const dates = ["2026-10-01", "2027-01-01", "2027-04-01", "2027-07-01"];
  for (let index = 0; index < 4; index++) {
    await page
      .locator(`#instalments-${String(index)}-dueOn`)
      .fill(dates[index] ?? "2026-10-01");
    await page
      .locator(`#instalments-${String(index)}-cheque-chequeNo`)
      .fill(`10000${String(index + 1)}`);
    await page
      .locator(`#instalments-${String(index)}-cheque-bankName`)
      .fill("Synthetic Bank");
    await expect(
      page.locator(`#instalments-${String(index)}-amountFils`),
    ).toHaveValue("21250.00");
  }
  await page
    .locator("#specialClauses-0-textEn")
    .fill("The tenant keeps the balcony clear.");
  await page
    .locator("#specialClauses-0-textAr")
    .fill("يلتزم المستأجر بإبقاء الشرفة خالية.");
  await expect(
    page.getByText("Instalments total AED 85,000.00, equal to the total."),
  ).toBeVisible();
  await accessible(page);
  await capture(page, `draft-${unit}.png`);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/contracts/[a-f0-9-]{36}$`));
  await expect(
    page.getByRole("heading", { name: "Bilingual preview" }),
  ).toBeVisible();
  await expect(page.locator('article[lang="en"]')).toContainText(
    "The tenant keeps the balcony clear.",
  );
  await expect(page.locator('article[lang="ar"][dir="rtl"]')).toContainText(
    "يلتزم المستأجر بإبقاء الشرفة خالية.",
  );
  return new URL(page.url()).pathname;
}
async function submit(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Submit for approval", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(
    "Submitting locks version 1. Khalid Al Suwaidi approves first, then Omar Farouk accepts.",
  );
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(
    page.getByText("Awaiting owner approval", { exact: true }),
  ).toBeVisible();
}
test.describe.serial("Contract drafting and decisions", () => {
  let contractPath = "";
  let returnedPath = "";
  test("manager drafts and three distinct sessions conclude the same version", async ({
    page,
    browser,
  }) => {
    await signIn(page);
    await page.goto(base);
    await expect(
      page.getByRole("heading", { level: 1, name: "Contracts", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "New contract", exact: true })
      .click();
    contractPath = await createDraft(page, "104");
    await submit(page);
    const ownerContext = await browser.newContext();
    const tenantContext = await browser.newContext();
    try {
      const owner = await ownerContext.newPage();
      await signIn(owner, "owner-1");
      await owner.goto(contractPath);
      await expect(
        owner.getByRole("button", { name: "Submit for approval", exact: true }),
      ).toHaveCount(0);
      await owner
        .getByRole("button", { name: "Approve version 1", exact: true })
        .click();
      await expect(owner.getByRole("dialog")).toContainText(
        "Approving sends version 1 to Omar Farouk for acceptance.",
      );
      await owner
        .getByRole("dialog")
        .getByRole("button", { name: "Confirm", exact: true })
        .click();
      await expect(
        owner.getByText("Awaiting tenant acceptance", { exact: true }),
      ).toBeVisible();
      const tenant = await tenantContext.newPage();
      await signIn(tenant, "tenant-1");
      await tenant.goto(contractPath);
      await expect(
        tenant.getByRole("button", {
          name: /Submit for approval|Approve version/,
        }),
      ).toHaveCount(0);
      await tenant
        .getByRole("button", { name: "Accept version 1", exact: true })
        .click();
      await expect(tenant.getByRole("dialog")).toContainText(
        "Accepting concludes the contract on version 1.",
      );
      await tenant
        .getByRole("dialog")
        .getByRole("button", { name: "Confirm", exact: true })
        .click();
      await expect(
        tenant.getByText("Concluded", { exact: true }),
      ).toBeVisible();
      const timeline = tenant.getByRole("list", {
        name: enApproval.timelineLabel,
      });
      await expect(timeline.locator('[data-tone="success"]')).toHaveCount(3);
      const evidence = tenant.getByRole("table", { name: "Approval evidence" });
      await expect(evidence.getByRole("row")).toHaveCount(4);
      const hashes = await evidence
        .locator('bdi[data-kind="prp"]')
        .allTextContents();
      expect(hashes).toHaveLength(3);
      expect(new Set(hashes).size).toBe(1);
      await expect(
        evidence.getByText("Own session", { exact: true }),
      ).toHaveCount(3);
      await accessible(tenant);
      await capture(tenant, "concluded-evidence.png");
    } finally {
      await ownerContext.close();
      await tenantContext.close();
    }
  });
  test("Arabic owner approval is accessible with RTL text and an LTR version hash", async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const path = await createDraft(page, "105");
    returnedPath = path;
    await submit(page);
    const context = await browser.newContext();
    try {
      const owner = await context.newPage();
      await signIn(owner, "owner-1", "ar");
      await owner.goto(path.replace("/en/", "/ar/"));
      await expect(owner.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(
        owner.getByRole("heading", {
          name: arContracts.preview,
        }),
      ).toBeVisible();
      await expect(
        owner.getByRole("heading", {
          name: arApprovals.decisionPanel,
        }),
      ).toBeVisible();
      await expect(
        owner.locator('bdi[data-kind="prp"]').first(),
      ).toHaveAttribute("dir", "ltr");
      await accessible(owner);
      expect(await owner.locator("main").innerText()).not.toMatch(
        /[\u0660-\u0669]/,
      );
      await capture(owner, "arabic-owner.png");
      await owner.setViewportSize({ width: 390, height: 844 });
      expect(
        await owner.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
      const preview = await owner.locator('article[lang="en"]').boundingBox();
      expect(preview?.width ?? 0).toBeGreaterThan(200);
      await capture(owner, "arabic-owner-mobile.png");
      await owner
        .getByRole("button", { name: arApprovals.return_owner })
        .click();
      const dialog = owner.getByRole("dialog");
      await dialog
        .getByRole("button", {
          name: arApprovals.confirm,
          exact: true,
        })
        .click();
      await expect(dialog.locator("#reason-error")).toHaveText(
        arContracts.errors.REASON_REQUIRED,
      );
      await expect(dialog.getByRole("alert")).toBeFocused();
      await dialog.getByRole("textbox").fill("يرجى تعديل تاريخ البداية.");
      await dialog
        .getByRole("button", {
          name: arApprovals.confirm,
          exact: true,
        })
        .click();
      await expect(
        owner.getByText(arStatus.contract.cancelled, {
          exact: true,
        }),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });
  test("foreign company paths are hidden and tenant sessions have no manager or owner commands", async ({
    page,
  }) => {
    await signIn(page, "owner-1");
    await page.goto(contractPath.replace(MOCK_COMPANY_A_ID, MOCK_COMPANY_B_ID));
    await expect(
      page.getByText(getMessages("en").States.notFound, { exact: true }),
    ).toBeVisible();
    await page.context().clearCookies();
    await signIn(page, "tenant-1");
    await page.goto(contractPath);
    await expect(
      page.getByRole("button", { name: /Submit for approval|Approve version/ }),
    ).toHaveCount(0);
    await expect(page.getByText("Concluded", { exact: true })).toBeVisible();
  });
  test("manager revises a returned contract, edits its draft and cancels with a reason", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(returnedPath);
    await page
      .getByRole("button", { name: "Create revised contract", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm", exact: true })
      .click();
    await expect(page).not.toHaveURL(new RegExp(`${returnedPath}$`));
    await expect(
      page.getByRole("link", { name: /Previous contract/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Close editor", exact: true }),
    ).toBeVisible();
    await expect(page.locator("#unitId")).toBeDisabled();
    await page.locator("#graceDays").fill("5");
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(page.locator('bdi[data-kind="prp"]').first()).toContainText(
      "v2 ·",
    );
    await expect(page.locator('article[lang="en"]')).toContainText(
      "Grace period: 5 days.",
    );
    await page
      .getByRole("button", { name: "Cancel draft", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("textbox")
      .fill("The synthetic tenant no longer needs this unit.");
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
    await expect(
      page.getByText("The synthetic tenant no longer needs this unit.", {
        exact: true,
      }),
    ).toBeVisible();
  });
});
