import { register, signIn, signOut, accessibility } from "./helpers";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { getMessages } from "../e2e/catalogues";
import { expectNavigation } from "../e2e/helpers";
import enMembers from "../../../packages/i18n/messages/en/Members.json" with { type: "json" };
import arMembers from "../../../packages/i18n/messages/ar/Members.json" with { type: "json" };
import enDomain from "../../../packages/i18n/messages/domain/en.json" with { type: "json" };
import arDomain from "../../../packages/i18n/messages/domain/ar.json" with { type: "json" };

// I close pages before failure diagnostics can retain an invitation link or account fields.
test.afterEach(async ({ page }) => {
  await page.close();
});
for (const locale of ["en", "ar"] as const) {
  test(`${locale} real API company and invitation journey`, async ({
    page,
  }) => {
    const started = Date.now();
    const suffix = randomUUID();
    const administrator = `admin-${suffix}@example.com`;
    const colleague = `member-${suffix}@example.com`;
    const password = `Journey-Aa1!${randomBytes(18).toString("base64url")}`;
    const companyName = {
      en: `Journey Properties ${suffix.slice(0, 8)}`,
      ar: `عقارات الرحلة ${suffix.slice(0, 8)}`,
    };
    const t = getMessages(locale);
    const m = locale === "ar" ? arMembers : enMembers;
    const labels = locale === "ar" ? arDomain : enDomain;
    let unsafeUrl = false;
    let unsafeReferer = false;
    let stage = "registration";
    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      const url = decodeURIComponent(frame.url());
      if (
        url.includes(administrator) ||
        url.includes(colleague) ||
        url.includes("token=")
      )
        unsafeUrl = true;
    });
    page.on("request", (request) => {
      const referer = request.headers().referer ?? "";
      if (referer.includes("#") || referer.includes("token="))
        unsafeReferer = true;
    });
    try {
      await page.goto(`/${locale}/sign-up`);
      await register(page, locale, administrator, password);
      await signIn(page, locale, administrator, password);
      await expect(page).toHaveURL(`/${locale}/setup/company`);
      stage = "company creation";
      await page.locator("#nameEn").fill(companyName.en);
      await page.locator("#nameAr").fill(companyName.ar);
      await page
        .locator("#tradeLicenceNumber")
        .fill(`JOURNEY-${suffix.slice(0, 8)}`);
      await page
        .getByRole("button", { name: t.Auth.createCompany, exact: true })
        .click();
      await expect(page).toHaveURL(
        new RegExp(`/${locale}/companies/[a-f0-9-]+/home$`),
      );
      const companyId = new URL(page.url()).pathname.split("/")[3];
      if (!companyId) throw new Error("Company id missing");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        t.Navigation.sections.home,
      );
      await expectNavigation(page, "admin-1", locale);
      await expect(page.locator("html")).toHaveAttribute(
        "dir",
        locale === "ar" ? "rtl" : "ltr",
      );
      stage = "invitation creation";
      await page
        .getByTestId("desktop-sidebar")
        .getByRole("link", { name: t.Navigation.sections.members, exact: true })
        .click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(m.title);
      await expect(page).toHaveTitle(
        `${m.title} · ${companyName[locale]} · ${t.Auth.brand}`,
      );
      await page.getByRole("button", { name: m.invite, exact: true }).click();
      const sheet = page.getByRole("dialog");
      await expect(sheet).toBeVisible();
      await accessibility(page);
      await sheet.getByLabel(m.email, { exact: true }).fill(colleague);
      await sheet
        .getByRole("checkbox", { name: labels.staffRole.manager, exact: true })
        .check();
      await sheet.getByRole("button", { name: m.send, exact: true }).click();
      await expect(sheet.getByText(m.not_configured)).toBeVisible();
      await expect(sheet.getByText(m.once)).toBeVisible();
      const inviteUrl = await sheet
        .getByLabel(m.link, { exact: true })
        .inputValue();
      const parsedLink = new URL(inviteUrl);
      expect(parsedLink.origin).toBe("http://127.0.0.1:3100");
      expect(parsedLink.pathname).toBe(`/${locale}/invitation`);
      expect(parsedLink.search).toBe("");
      expect(parsedLink.hash.length).toBe(44);
      await page.keyboard.press("Escape");
      await expect(sheet).not.toBeVisible();
      await expect(
        page
          .getByRole("table", { name: m.invitations })
          .getByRole("row")
          .filter({ hasText: colleague }),
      ).toHaveCount(1);
      const invitedRow = page
        .getByRole("table", { name: m.invitations })
        .getByRole("row")
        .filter({ hasText: colleague });
      await expect(
        invitedRow.getByText(labels.invitationStatus.pending, { exact: true }),
      ).toBeVisible();
      stage = "invitation preview";
      await signOut(page, locale);
      await page.evaluate((link) => {
        window.location.assign(link);
      }, inviteUrl);
      await expect(
        page.getByRole("heading", { name: companyName[locale], exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(labels.staffRole.manager, { exact: true }),
      ).toBeVisible();
      await expect.poll(() => new URL(page.url()).hash).toBe("");
      await expect(page).toHaveTitle(`${m.invitationTitle} · ${t.Auth.brand}`);
      expect(
        await page.evaluate(() =>
          Boolean(sessionStorage.getItem("aqarak.pendingInvitation")),
        ),
      ).toBe(true);
      await accessibility(page);
      stage = "colleague registration";
      await page
        .getByRole("link", { name: m.createAccount, exact: true })
        .click();
      await register(page, locale, colleague, password);
      await signIn(page, locale, colleague, password);
      await expect(page).toHaveURL(`/${locale}/invitation`);
      stage = "invitation acceptance";
      await page.getByRole("button", { name: m.accept, exact: true }).click();
      await expect(page).toHaveURL(`/${locale}/companies/${companyId}/home`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        t.Navigation.sections.home,
      );
      await expectNavigation(page, "manager-1", locale);
      expect(
        await page.evaluate(
          () => sessionStorage.getItem("aqarak.pendingInvitation") === null,
        ),
      ).toBe(true);
      stage = "administrator confirmation";
      await signOut(page, locale);
      await signIn(page, locale, administrator, password);
      await expect(page).toHaveURL(`/${locale}/companies/${companyId}/home`);
      await page
        .getByTestId("desktop-sidebar")
        .getByRole("link", { name: t.Navigation.sections.members, exact: true })
        .click();
      const member = page
        .getByRole("table", { name: m.title, exact: true })
        .getByRole("row")
        .filter({ hasText: colleague });
      await expect(
        member.getByText(labels.membershipStatus.active, { exact: true }),
      ).toBeVisible();
      await expect(
        member.getByText(labels.staffRole.manager, { exact: true }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("table", { name: m.invitations })
          .getByRole("row")
          .filter({ hasText: colleague })
          .getByText(labels.invitationStatus.accepted, { exact: true }),
      ).toBeVisible();
      expect(unsafeUrl).toBe(false);
      expect(unsafeReferer).toBe(false);
      process.stdout.write(
        `${locale}: company ${companyId}; duration ${((Date.now() - started) / 1000).toFixed(1)}s\n`,
      );
    } catch {
      throw new Error(`Real API journey stopped during ${stage} (${locale}).`);
    }
  });
}
