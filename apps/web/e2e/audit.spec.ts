import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import en from "../../../packages/i18n/messages/en/Audit.json" with { type: "json" };
import ar from "../../../packages/i18n/messages/ar/Audit.json" with { type: "json" };
import {
  MOCK_COMPANY_A_ID,
  MOCK_ACCOUNT_IDS,
} from "../src/lib/api/mock-fixtures";
import { signIn } from "./helpers";
const base = (locale = "en"): string =>
  `/${locale}/companies/${MOCK_COMPANY_A_ID}/audit`;
for (const locale of ["en", "ar"] as const) {
  const t = locale === "en" ? en : ar;
  test(`AC-1 ${locale}: refusals, filters and accessible audit trail`, async ({
    page,
  }, testInfo) => {
    await signIn(page, "manager-1", locale);
    await page.goto(base(locale));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.title);
    const row = page.locator('tr[data-refused="true"]');
    await expect(row).toContainText("policy.denied");
    await expect(row).toContainText("Mariam Al Nuaimi");
    await expect(row).toContainText(t.sampleDenied);
    await expect(row).toHaveAttribute("data-tone", "danger");
    const seqs = await page
      .locator("tbody tr")
      .evaluateAll((rows) =>
        rows.map((r) => Number(r.getAttribute("data-seq"))),
      );
    expect(seqs).toEqual([...seqs].sort((a, b) => b - a));
    const heights = await page
      .locator("tbody tr")
      .evaluateAll((rows) =>
        rows.map((row) => row.getBoundingClientRect().height),
      );
    expect(heights.every((height) => height >= 40 && height <= 44)).toBe(true);
    await page.getByLabel(t.refusalsOnly, { exact: true }).check();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(row).toBeVisible();
    await page
      .getByLabel(t.actor, { exact: true })
      .fill(MOCK_ACCOUNT_IDS["manager-1"]);
    await page.getByRole("button", { name: t.applyFilters }).click();
    await expect(page.getByText(t.noMatches, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: t.clearFilters }).click();
    await expect(page.locator("tbody tr")).toHaveCount(8);
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      axe.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      ),
    ).toEqual([]);
    await expect(page.locator("html")).toHaveAttribute(
      "dir",
      locale === "ar" ? "rtl" : "ltr",
    );
    await page.screenshot({
      path: testInfo.outputPath(`audit-${locale}.png`),
      fullPage: true,
    });
  });
  test(`AC-2 ${locale}: verification range, anchor and first broken sequence`, async ({
    page,
  }) => {
    await signIn(page, "manager-1", locale);
    await page.goto(base(locale));
    const banner = page.getByTestId("verification-banner");
    await expect(banner).toContainText(t.neutral);
    await page.getByRole("button", { name: t.verify, exact: true }).click();
    await expect(banner).toContainText(t.verified);
    await expect(banner).toContainText(
      t.range
        .replace("{first}", "1")
        .replace("{last}", "8")
        .replace("{count}", "8"),
    );
    await expect(banner).toContainText(t.noAnchor);
    await page.getByRole("button", { name: t.anchorNow }).click();
    await expect(banner).not.toContainText(t.noAnchor);
    await page.getByRole("button", { name: t.verify, exact: true }).click();
    await expect(banner).toContainText(t.verified);
    await page.goto(`${base(locale)}?scenario=tampered`);
    await page.getByRole("button", { name: t.verify, exact: true }).click();
    await expect(banner).toContainText(
      t.broken
        .replace("{seq}", "7")
        .replace("{kind}", t.kinds.row_hash_mismatch),
    );
  });
  test(`AC-3 ${locale}: filtered CSV download retains API filename and header`, async ({
    page,
  }) => {
    await signIn(page, "manager-1", locale);
    await page.goto(base(locale));
    await page.getByLabel(t.refusalsOnly, { exact: true }).check();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: t.export, exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(
      new RegExp(`^audit-${MOCK_COMPANY_A_ID}-\\d{8}T\\d{6}Z\\.csv$`),
    );
    const path = await download.path();
    if (!path) throw new Error("Missing download");
    const csv = await readFile(path, "utf8");
    expect(csv.replace(/^\uFEFF/, "").split("\r\n")[0]).toBe(
      "seq,occurred_at,event_type,actor_account_id,actor_name,actor_role,initiator,channel,subject_type,subject_id,version_before,version_after,reason,prev_hash,row_hash",
    );
    expect(csv).toContain("policy.denied");
    expect(csv).not.toContain("extraction.created");
  });
  for (const handle of ["accountant-1", "technician-1"])
    test(`AC-7 ${locale}: ${handle} sees the audit permission reason`, async ({
      page,
    }) => {
      await signIn(page, handle, locale);
      await page.goto(base(locale));
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        t.notPermitted,
      );
      await expect(
        page.getByText(t.permissionReason, { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: t.verify })).toHaveCount(0);
    });
}
test("audit company administrator access and offline state", async ({
  page,
}) => {
  await signIn(page, "admin-1");
  await page.goto(base());
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.title);
  await page.context().setOffline(true);
  await expect(
    page.getByRole("main").getByRole("status").filter({ hasText: en.offline }),
  ).toBeVisible();
  await page.context().setOffline(false);
});
