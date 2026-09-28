import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import { z } from "zod";
import { register, signIn, accessibility } from "./helpers";
import { denialCount } from "./audit";
import { getMessages } from "../e2e/catalogues";
import enMembers from "../../../packages/i18n/messages/en/Members.json" with { type: "json" };
import arMembers from "../../../packages/i18n/messages/ar/Members.json" with { type: "json" };
import enCompany from "../../../packages/i18n/messages/en/Company.json" with { type: "json" };
import arCompany from "../../../packages/i18n/messages/ar/Company.json" with { type: "json" };
import enDomain from "../../../packages/i18n/messages/domain/en.json" with { type: "json" };
import arDomain from "../../../packages/i18n/messages/domain/ar.json" with { type: "json" };
const membersSchema = z.object({
  members: z.array(
    z.object({
      membershipId: z.uuid(),
      accountId: z.uuid(),
      version: z.number().int(),
    }),
  ),
});
const meSchema = z.object({ account: z.object({ id: z.uuid() }) });
async function session(context: BrowserContext): Promise<string> {
  const cookie = (await context.cookies()).find(
    (item) => item.name === "__Host-aqarak-sid",
  );
  if (!cookie) throw new Error("Session unavailable");
  return cookie.value;
}
// I close every page before diagnostics can retain invitation links or account fields.
test.afterEach(async ({ context }) => {
  await Promise.all(context.pages().map((page) => page.close()));
});
for (const locale of ["en", "ar"] as const) {
  test(`${locale} real API members lifecycle and company settings`, async ({
    page,
    browser,
  }) => {
    const started = Date.now();
    const suffix = randomUUID();
    const adminEmail = `admin-${suffix}@example.com`;
    const managerEmail = `manager-${suffix}@example.com`;
    const password = `Journey-Aa1!${randomBytes(18).toString("base64url")}`;
    const companyName = {
      en: `Member Journey ${suffix.slice(0, 8)}`,
      ar: `شركة الأعضاء ${suffix.slice(0, 8)}`,
    };
    const m = locale === "ar" ? arMembers : enMembers;
    const c = locale === "ar" ? arCompany : enCompany;
    const labels = locale === "ar" ? arDomain : enDomain;
    const t = getMessages(locale);
    let stage = "setup";
    const managerContext = await browser.newContext({
      baseURL: "http://127.0.0.1:3100",
    });
    const manager = await managerContext.newPage();
    try {
      await page.goto(`/${locale}/sign-up`);
      await register(
        page,
        locale,
        adminEmail,
        password,
        "Journey Administrator",
      );
      await signIn(page, locale, adminEmail, password);
      await expect(page).toHaveURL(`/${locale}/setup/company`);
      await page.locator("#nameEn").fill(companyName.en);
      await page.locator("#nameAr").fill(companyName.ar);
      await page
        .locator("#tradeLicenceNumber")
        .fill(`MEMBER-${suffix.slice(0, 8)}`);
      await page
        .getByRole("button", { name: t.Auth.createCompany, exact: true })
        .click();
      await expect(page).toHaveURL(
        new RegExp(`/${locale}/companies/[a-f0-9-]+/home$`),
      );
      const companyId = new URL(page.url()).pathname.split("/")[3];
      if (!companyId) throw new Error("Company missing");
      const membersPath = `/${locale}/companies/${companyId}/members`;
      await page.goto(membersPath);
      async function invite(email: string): Promise<string> {
        await page.getByRole("button", { name: m.invite, exact: true }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel(m.email, { exact: true }).fill(email);
        await dialog
          .getByRole("checkbox", {
            name: labels.staffRole.manager,
            exact: true,
          })
          .check();
        await dialog.getByRole("button", { name: m.send, exact: true }).click();
        await expect(dialog.getByLabel(m.link)).toBeVisible();
        const link = await dialog.getByLabel(m.link).inputValue();
        await page.keyboard.press("Escape");
        await expect(dialog).not.toBeVisible();
        return link;
      }
      const link = await invite(managerEmail);
      await manager.goto(link);
      await manager
        .getByRole("link", { name: m.createAccount, exact: true })
        .click();
      await register(
        manager,
        locale,
        managerEmail,
        password,
        "Journey Manager",
      );
      await signIn(manager, locale, managerEmail, password);
      await expect(manager).toHaveURL(`/${locale}/invitation`);
      await manager
        .getByRole("button", { name: m.accept, exact: true })
        .click();
      await expect(manager).toHaveURL(`/${locale}/companies/${companyId}/home`);
      await page.reload();
      const row = page
        .getByRole("table", { name: m.title, exact: true })
        .getByRole("row")
        .filter({ hasText: managerEmail });
      async function openMember(action: string, target = row): Promise<void> {
        await target.getByRole("button", { name: /Journey/ }).click();
        await page.getByRole("menuitem", { name: action, exact: true }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await accessibility(page);
      }
      stage = "MJ-1 roles";
      process.stdout.write(`${locale}: MJ-1 roles\n`);
      await openMember(m.changeRoles);
      await page
        .getByRole("dialog")
        .getByRole("checkbox", {
          name: labels.staffRole.accountant,
          exact: true,
        })
        .check();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: m.changeRoles, exact: true })
        .click();
      await expect(page.getByRole("dialog")).not.toBeVisible();
      await expect(row).toContainText(labels.staffRole.manager);
      await expect(row).toContainText(labels.staffRole.accountant);
      stage = "MJ-2 suspension and next-request denial";
      process.stdout.write(
        `${locale}: MJ-2 suspension and next-request denial\n`,
      );
      await openMember(m.suspend);
      await page
        .getByLabel(m.reason, { exact: true })
        .fill("Synthetic access review");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: m.suspend, exact: true })
        .click();
      await expect(row).toContainText(labels.membershipStatus.suspended);
      const adminSession = await session(page.context());
      const managerSession = await session(managerContext);
      const apiOrigin = "http://127.0.0.1:4010";
      async function apiRead(path: string, sid: string): Promise<Response> {
        return fetch(`${apiOrigin}${path}`, {
          headers: { Authorization: `Session ${sid}` },
        });
      }
      const me = meSchema.parse(
        await (await apiRead("/v1/me", adminSession)).json(),
      );
      const before = await denialCount(companyId, me.account.id);
      const denied = await apiRead(
        `/v1/companies/${companyId}`,
        managerSession,
      );
      expect(denied.status).toBe(404);
      expect(
        z.object({ code: z.string() }).parse(await denied.json()).code,
      ).toBe("NOT_FOUND");
      expect(await denialCount(companyId, me.account.id)).toBe(before + 1);
      await manager.goto(`/${locale}/companies/${companyId}/home`);
      await expect(manager.getByRole("heading", { level: 1 })).toHaveText(
        t.Shell.notFound,
      );
      await manager.goto(`/${locale}/companies`);
      await expect(
        manager.getByText(t.Shell.noCompanies, { exact: true }),
      ).toBeVisible();
      await expect(
        manager.getByRole("link", { name: companyName[locale] }),
      ).toHaveCount(0);
      stage = "MJ-3 reactivation";
      process.stdout.write(`${locale}: MJ-3 reactivation\n`);
      await openMember(m.reactivate);
      await page
        .getByRole("dialog")
        .getByRole("button", { name: m.reactivate, exact: true })
        .click();
      await expect(row).toContainText(labels.membershipStatus.active);
      await manager.goto(`/${locale}/companies/${companyId}/home`);
      await expect(manager.getByRole("heading", { level: 1 })).toHaveText(
        t.Navigation.sections.home,
      );
      stage = "MJ-4 last administrator";
      process.stdout.write(`${locale}: MJ-4 last administrator\n`);
      const members = membersSchema.parse(
        await (
          await apiRead(`/v1/companies/${companyId}/members`, adminSession)
        ).json(),
      );
      const adminMember = members.members.find(
        (item) => item.accountId === me.account.id,
      );
      if (!adminMember) throw new Error("Administrator missing");
      const refused = await fetch(
        `${apiOrigin}/v1/companies/${companyId}/members/${adminMember.membershipId}/suspend`,
        {
          method: "POST",
          headers: {
            Authorization: `Session ${adminSession}`,
            "Content-Type": "application/json",
            "Idempotency-Key": randomUUID(),
          },
          body: JSON.stringify({
            expectedVersion: adminMember.version,
            reason: "Synthetic last administrator test",
          }),
        },
      );
      expect(refused.status).toBe(409);
      expect(
        z.object({ code: z.string() }).parse(await refused.json()).code,
      ).toBe("LAST_ADMINISTRATOR");
      const adminRow = page
        .getByRole("table", { name: m.title, exact: true })
        .getByRole("row")
        .filter({ hasText: adminEmail });
      await openMember(m.changeRoles, adminRow);
      await page
        .getByRole("dialog")
        .getByRole("checkbox", { name: labels.staffRole.manager, exact: true })
        .check();
      await page
        .getByRole("dialog")
        .getByRole("checkbox", {
          name: labels.staffRole.company_administrator,
          exact: true,
        })
        .uncheck();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: m.changeRoles, exact: true })
        .click();
      await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(
        m.LAST_ADMINISTRATOR,
      );
      await page.keyboard.press("Escape");
      stage = "MJ-5 invitations";
      process.stdout.write(`${locale}: MJ-5 invitations\n`);
      const revokeEmail = `revoke-${suffix}@example.com`;
      await invite(revokeEmail);
      const invitations = page.getByRole("table", {
        name: m.invitations,
        exact: true,
      });
      const revokeRow = invitations
        .getByRole("row")
        .filter({ hasText: revokeEmail });
      await revokeRow
        .getByRole("button", { name: m.revoke, exact: true })
        .click();
      await accessibility(page);
      await page
        .getByLabel(m.reason, { exact: true })
        .fill("Synthetic invitation withdrawal");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: m.revoke, exact: true })
        .click();
      await expect(revokeRow).toContainText(labels.invitationStatus.revoked);
      const resendEmail = `resend-${suffix}@example.com`;
      const firstLink = await invite(resendEmail);
      await invitations
        .getByRole("row")
        .filter({ hasText: resendEmail })
        .getByRole("button", { name: m.resend, exact: true })
        .click();
      await accessibility(page);
      await page
        .getByRole("dialog")
        .getByRole("button", { name: m.resend, exact: true })
        .click();
      await expect(page.getByLabel(m.link)).toBeVisible();
      expect((await page.getByLabel(m.link).inputValue()) === firstLink).toBe(
        false,
      );
      await expect(page.getByText(m.once)).toBeVisible();
      await page.keyboard.press("Escape");
      stage = "MJ-7 removal dialog";
      process.stdout.write(`${locale}: MJ-7 removal dialog\n`);
      await openMember(m.remove);
      await expect(page.getByRole("dialog")).toContainText(m.removeConsequence);
      await page.keyboard.press("Escape");
      stage = "MJ-6 settings and stale tab";
      process.stdout.write(`${locale}: MJ-6 settings and stale tab\n`);
      const settingsPath = `/${locale}/companies/${companyId}/settings`;
      stage = "MJ-6 settings load";
      await page.goto(settingsPath);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(c.title);
      await accessibility(page);
      const stale = await page.context().newPage();
      stage = "MJ-6 stale tab load";
      await stale.goto(settingsPath);
      stage = "MJ-6 save confirmation";
      const changedName = `${companyName.en} Updated`;
      await page.getByLabel(c.nameEn, { exact: true }).fill(changedName);
      await page.getByRole("button", { name: c.save, exact: true }).click();
      await expect(page.getByText(c.saved, { exact: true })).toBeVisible();
      stage = "MJ-6 updated title";
      await expect(page).toHaveTitle(
        `${c.title} · ${locale === "en" ? changedName : companyName.ar} · ${t.Auth.brand}`,
      );
      stage = "MJ-6 updated header";
      if (locale === "en")
        await expect(page.getByTestId("desktop-sidebar")).toContainText(
          changedName,
        );
      stage = "MJ-6 stale save";
      await stale
        .getByLabel(c.nameEn, { exact: true })
        .fill(`${companyName.en} Stale edit`);
      await stale.getByRole("button", { name: c.save, exact: true }).click();
      await expect(
        stale.getByRole("alert").filter({ hasText: c.VERSION_CONFLICT }),
      ).toBeVisible();
      await expect(stale.getByLabel(c.nameEn)).toHaveValue(
        `${companyName.en} Stale edit`,
      );
      await stale.close();
      process.stdout.write(
        `${locale}: member journey company ${companyId}; one suspension denial verified; duration ${((Date.now() - started) / 1000).toFixed(1)}s\n`,
      );
    } catch {
      throw new Error(`Members journey stopped during ${stage} (${locale}).`);
    } finally {
      await managerContext.close();
      await Promise.all(
        page
          .context()
          .pages()
          .map((item: Page) => item.close()),
      );
    }
  });
}
