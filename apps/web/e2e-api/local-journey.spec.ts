import { stripVTControlCharacters } from "node:util";
import enOwners from "../../../packages/i18n/messages/en/Owners.json" with { type: "json" };
import enProperties from "../../../packages/i18n/messages/en/Properties.json" with { type: "json" };
import enUnits from "../../../packages/i18n/messages/en/Units.json" with { type: "json" };
import enTenants from "../../../packages/i18n/messages/en/Tenants.json" with { type: "json" };
import enDocuments from "../../../packages/i18n/messages/en/Documents.json" with { type: "json" };
import enContracts from "../../../packages/i18n/messages/en/Contracts.json" with { type: "json" };
import enApprovals from "../../../packages/i18n/messages/en/Approvals.json" with { type: "json" };
import enMembers from "../../../packages/i18n/messages/en/Members.json" with { type: "json" };
import enCommon from "../../../packages/i18n/messages/en/Common.json" with { type: "json" };
import enStatus from "../../../packages/i18n/messages/en/Status.json" with { type: "json" };
import enReview from "../../../packages/i18n/messages/en/Review.json" with { type: "json" };
import enTawtheeq from "../../../packages/i18n/messages/en/Tawtheeq.json" with { type: "json" };
import enAudit from "../../../packages/i18n/messages/en/Audit.json" with { type: "json" };
import arOwners from "../../../packages/i18n/messages/ar/Owners.json" with { type: "json" };
import arProperties from "../../../packages/i18n/messages/ar/Properties.json" with { type: "json" };
import arUnits from "../../../packages/i18n/messages/ar/Units.json" with { type: "json" };
import arTenants from "../../../packages/i18n/messages/ar/Tenants.json" with { type: "json" };
import arDocuments from "../../../packages/i18n/messages/ar/Documents.json" with { type: "json" };
import arContracts from "../../../packages/i18n/messages/ar/Contracts.json" with { type: "json" };
import arApprovals from "../../../packages/i18n/messages/ar/Approvals.json" with { type: "json" };
import arMembers from "../../../packages/i18n/messages/ar/Members.json" with { type: "json" };
import arCommon from "../../../packages/i18n/messages/ar/Common.json" with { type: "json" };
import arStatus from "../../../packages/i18n/messages/ar/Status.json" with { type: "json" };
import arReview from "../../../packages/i18n/messages/ar/Review.json" with { type: "json" };
import arTawtheeq from "../../../packages/i18n/messages/ar/Tawtheeq.json" with { type: "json" };
import arAudit from "../../../packages/i18n/messages/ar/Audit.json" with { type: "json" };
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { getMessages as authMessages } from "../e2e/catalogues";
import { z } from "zod";
import { register, signIn } from "./helpers";

const record = z.record(z.string(), z.unknown());
const labelSchema = z.object({
  kind: z.string(),
  image: z.string(),
  fields: z.record(
    z.string(),
    z.object({ value: z.union([z.string(), z.number(), z.null()]) }),
  ),
});
const dataset = resolve(
  process.cwd(),
  "../../evaluation/datasets/synthetic-docs-v1",
);
const labels = readFileSync(resolve(dataset, "labels.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => labelSchema.parse(JSON.parse(line) as unknown));
const identity = labels.find(
  (item) =>
    item.kind === "emirates_id" &&
    ["id_number", "name_en", "name_ar", "expiry_date"].every(
      (key) => item.fields[key]?.value,
    ),
);
const certificate = labels.find((item) => item.kind === "tawtheeq_contract");
if (!identity) throw new Error("A readable synthetic Emirates ID is required");

const journeyDomain =
  process.env.AQARAK_DEPLOYED_JOURNEY === "1" ? "dev.aqarak.ae" : "example.com";
for (const locale of ["en", "ar"] as const) {
  test(`${locale} J1 to J7 ${process.env.AQARAK_DEPLOYED_JOURNEY === "1" ? "deployed" : "local database"} journey`, async ({
    page,
    browser,
    baseURL,
  }, testInfo) => {
    const t = {
      ...authMessages(locale),
      Owners: locale === "ar" ? arOwners : enOwners,
      Properties: locale === "ar" ? arProperties : enProperties,
      Units: locale === "ar" ? arUnits : enUnits,
      Tenants: locale === "ar" ? arTenants : enTenants,
      Documents: locale === "ar" ? arDocuments : enDocuments,
      Contracts: locale === "ar" ? arContracts : enContracts,
      Approvals: locale === "ar" ? arApprovals : enApprovals,
      Members: locale === "ar" ? arMembers : enMembers,
      Common: locale === "ar" ? arCommon : enCommon,
      Status: locale === "ar" ? arStatus : enStatus,
      Review: locale === "ar" ? arReview : enReview,
      Tawtheeq: locale === "ar" ? arTawtheeq : enTawtheeq,
      Audit: locale === "ar" ? arAudit : enAudit,
    };
    const suffix = randomUUID();
    const password = `Synthetic-${randomUUID()}!`;
    const domain = journeyDomain;
    const managerEmail = `journey-manager-${suffix}@${domain}`;
    const ownerEmail = `journey-owner-${suffix}@${domain}`;
    const tenantEmail = `journey-tenant-${suffix}@${domain}`;
    const results: {
      step: string;
      status: "passed" | "blocked";
      reason?: string;
    }[] = [];
    let companyId = "";
    let ownerId = "";
    let tenantId = "";
    let contractPath = "";
    let submitted = false;
    let concluded = false;
    let ownerPage: Page | undefined;
    let tenantPage: Page | undefined;
    const contexts = [] as Awaited<ReturnType<typeof browser.newContext>>[];
    const base = () => `/${locale}/companies/${companyId}`;
    async function stage(
      name: string,
      run: () => Promise<void>,
    ): Promise<void> {
      await test.step(name, async (step) => {
        try {
          await run();
          results.push({ step: name, status: "passed" });
          process.stdout.write(`${locale} ${name}: passed\n`);
        } catch (error) {
          const alerts = await page
            .getByRole("alert")
            .allTextContents()
            .catch(() => []);
          const raw =
            (error instanceof Error
              ? error.message
              : "Unknown journey failure") +
            (alerts.length ? ` Screen: ${alerts.join("; ")}` : "");
          const reason = stripVTControlCharacters(raw)
            .replace(/[A-Za-z0-9_-]{43,}/g, "[redacted]")
            .slice(0, 1800);
          results.push({ step: name, status: "blocked", reason });
          process.stdout.write(`${locale} ${name}: blocked: ${reason}\n`);
          step.skip(true, reason);
        }
      });
    }
    async function api(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<Record<string, unknown>> {
      const session = (await page.context().cookies()).find(
        (cookie) => cookie.name === "__Host-aqarak-sid",
      )?.value;
      if (!session) throw new Error("The manager has no verified web session");
      const response = await fetch(
        `${(process.env.AQARAK_API_BASE_URL ?? "http://127.0.0.1:4000").replace(/\/$/u, "")}/v1/companies/${companyId}${path}`,
        {
          method,
          headers: {
            Authorization: `Session ${session}`,
            "Content-Type": "application/json",
            "Idempotency-Key": randomUUID(),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
      );
      const value = record.parse(await response.json());
      if (!response.ok)
        throw new Error(
          `${method} ${path}: HTTP ${String(response.status)}, ${typeof value.code === "string" ? value.code : "unknown"}`,
        );
      return value;
    }
    async function invite(
      kind: "owner" | "tenant",
      id: string,
      email: string,
    ): Promise<Page> {
      await api(
        "POST",
        `/${kind === "owner" ? "owners" : "tenants"}/${id}/${kind === "owner" ? "invitation" : "invitations"}`,
        {},
      );
      const list = z
        .object({
          invitations: z.array(
            z.object({
              id: z.string(),
              email: z.string(),
              version: z.number(),
            }),
          ),
        })
        .parse(await api("GET", "/invitations"));
      const invitation = list.invitations.find((item) => item.email === email);
      if (!invitation) throw new Error("The party invitation was not listed");
      const issued = z.object({ acceptPath: z.string() }).parse(
        await api("POST", `/invitations/${invitation.id}/resend`, {
          expectedVersion: invitation.version,
        }),
      );
      const context = await browser.newContext({ baseURL });
      contexts.push(context);
      const invited = await context.newPage();
      await invited.goto(`/${locale}/sign-up`);
      await register(invited, locale, email, password, `Synthetic ${kind}`);
      await signIn(invited, locale, email, password);
      await expect(invited).toHaveURL(
        new RegExp(`/${locale}/(setup/company|companies/)`),
      );
      await invited.goto(issued.acceptPath);
      await invited
        .getByRole("button", { name: t.Members.accept, exact: true })
        .click();
      await expect(invited).toHaveURL(
        new RegExp(`/companies/${companyId}/home$`),
      );
      return invited;
    }
    try {
      await stage("J1 registration, sign-in and company", async () => {
        await page.goto(`/${locale}/sign-up`);
        await register(page, locale, managerEmail, password);
        await signIn(page, locale, managerEmail, password);
        await expect(page).toHaveURL(`/${locale}/setup/company`);
        await page
          .locator("#nameEn")
          .fill(`Synthetic Journey ${suffix.slice(0, 8)}`);
        await page
          .locator("#nameAr")
          .fill(`شركة الرحلة التجريبية ${suffix.slice(0, 8)}`);
        await page
          .locator("#tradeLicenceNumber")
          .fill(`SYN-${suffix.slice(0, 8)}`);
        await page
          .getByRole("button", { name: t.Auth.createCompany, exact: true })
          .click();
        await expect(page).toHaveURL(
          new RegExp(`/companies/[a-f0-9-]{36}/home$`),
        );
        companyId = new URL(page.url()).pathname.split("/")[3] ?? "";
        await expect(page.locator("html")).toHaveAttribute(
          "dir",
          locale === "ar" ? "rtl" : "ltr",
        );
        const members = z
          .object({
            members: z.array(
              z.object({
                membershipId: z.string(),
                version: z.number(),
                email: z.string(),
              }),
            ),
          })
          .parse(await api("GET", "/members"));
        const self = members.members.find(
          (item) => item.email === managerEmail,
        );
        if (!self) throw new Error("Company administrator membership missing");
        await api("POST", `/members/${self.membershipId}/roles`, {
          expectedVersion: self.version,
          staffRoles: ["company_administrator", "manager"],
        });
      });
      await stage(
        "J2 owner, gated mandate, property and two units",
        async () => {
          if (!companyId) throw new Error("J1 did not create a company");
          await page.goto(`${base()}/owners`);
          await page
            .getByRole("button", { name: t.Owners.add, exact: true })
            .click();
          await page
            .getByLabel(t.Owners.fullNameEn)
            .fill("Synthetic Journey Owner");
          await page
            .getByLabel(t.Owners.fullNameAr)
            .fill("مالك الرحلة التجريبي");
          await page
            .getByLabel(t.Owners.email, { exact: true })
            .fill(ownerEmail);
          await page
            .getByRole("button", { name: t.Owners.add, exact: true })
            .click();
          await expect(page).toHaveURL(/\/owners\/[a-f0-9-]{36}$/);
          ownerId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
          await page
            .getByRole("link", { name: t.Owners.recordMandate })
            .click();
          await page.getByLabel(t.Owners.gateOn).check();
          await page.getByLabel(t.Owners.costThresholdAed).fill("2000");
          await page.getByLabel(t.Owners.fee).fill("5");
          await page.getByLabel(t.Owners.startsOn).fill("2026-09-28");
          await page
            .getByRole("button", { name: t.Owners.continue, exact: true })
            .click();
          await page
            .getByRole("button", { name: t.Owners.saveMandate })
            .click();
          await expect(
            page.getByText(t.Owners.mandateSaved, { exact: true }),
          ).toBeVisible();
          await page.goto(`${base()}/properties/new`);
          await page
            .getByLabel(t.Properties.fullNameEn)
            .fill("Synthetic Journey Residence");
          await page
            .getByLabel(t.Properties.fullNameAr)
            .fill("مبنى الرحلة التجريبي");
          await page
            .getByLabel(t.Properties.owner, { exact: true })
            .selectOption(ownerId);
          await page
            .getByRole("button", { name: t.Properties.add, exact: true })
            .click();
          await page
            .getByRole("dialog")
            .getByRole("button", { name: t.Common.close, exact: true })
            .click();
          await page
            .getByRole("link", { name: t.Properties.addUnits, exact: true })
            .click();
          await page.getByLabel(t.Units.unitNo, { exact: true }).fill("101");
          await page
            .getByRole("button", { name: t.Units.addRow, exact: true })
            .click();
          await page
            .getByLabel(t.Units.unitNo, { exact: true })
            .nth(1)
            .fill("102");
          await page
            .getByRole("button", { name: t.Units.submit, exact: true })
            .click();
          await expect(
            page
              .getByRole("row")
              .filter({ has: page.getByText("102", { exact: true }) }),
          ).toBeVisible();
        },
      );
      await stage(
        "J3 tenant, upload, extraction, review and save",
        async () => {
          if (!companyId) throw new Error("J1 did not create a company");
          await page.goto(`${base()}/tenants/new`);
          await page
            .getByLabel(t.Tenants.create.fullNameEn)
            .fill(String(identity.fields.name_en?.value));
          await page
            .getByLabel(t.Tenants.create.fullNameAr)
            .fill(String(identity.fields.name_ar?.value));
          await page
            .getByLabel(t.Tenants.create.email, { exact: true })
            .fill(tenantEmail);
          await page
            .getByRole("button", { name: t.Tenants.add, exact: true })
            .click();
          await expect(page).toHaveURL(/\/tenants\/[a-f0-9-]{36}$/);
          tenantId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
          await page
            .getByRole("button", { name: t.Tenants.upload, exact: true })
            .click();
          await page
            .getByLabel(t.Documents.chooseFile, { exact: true })
            .setInputFiles(resolve(dataset, identity.image));
          await page
            .getByRole("button", { name: t.Documents.start, exact: true })
            .click();
          await expect(
            page.getByRole("heading", {
              name: t.Documents.reviewTitle,
              exact: true,
            }),
          ).toBeVisible({ timeout: 120_000 });
          for (const [key, label] of Object.entries(t.Documents.fields)) {
            const field = page.getByTestId(`field-${key}`);
            const source = field.getByRole("button", {
              name: t.Review.viewSource.replace("{field}", label),
              exact: true,
            });
            if (await source.isVisible()) await source.click();
            const value = identity.fields[key]?.value;
            if (value === null || value === undefined)
              await field
                .getByRole("button", {
                  name: t.Review.notOnDocument,
                  exact: true,
                })
                .click();
            else {
              await field
                .getByRole("button", {
                  name: t.Review.editField.replace("{field}", label),
                  exact: true,
                })
                .click();
              await field.locator("input").fill(String(value));
              await field.locator("input").press("Enter");
            }
          }
          await page
            .getByRole("button", { name: t.Review.continue, exact: true })
            .click();
          await page
            .getByRole("button", { name: t.Documents.save, exact: true })
            .click();
          await expect(
            page.getByText(t.Tenants.saved, { exact: true }),
          ).toBeVisible();
        },
      );
      await stage("J4 invitations, draft and submit contract", async () => {
        if (!ownerId || !tenantId)
          throw new Error("J2 and J3 must create both parties");
        ownerPage = await invite("owner", ownerId, ownerEmail);
        tenantPage = await invite("tenant", tenantId, tenantEmail);
        await page.goto(`${base()}/contracts/new`);
        await page.locator("#unitId").selectOption({ index: 1 });
        await page.locator("#tenantId").selectOption(tenantId);
        await page.locator("#termStart").fill("2026-10-01");
        await page.locator("#termEnd").fill("2027-09-30");
        await page.locator("#annualRentFils").fill("85000");
        await page.locator("#totalFils").fill("85000");
        await page
          .getByRole("button", { name: t.Contracts.split, exact: true })
          .click();
        for (const [index, date] of [
          "2026-10-01",
          "2027-01-01",
          "2027-04-01",
          "2027-07-01",
        ].entries()) {
          await page.locator(`#instalments-${String(index)}-dueOn`).fill(date);
          await page
            .locator(`#instalments-${String(index)}-cheque-chequeNo`)
            .fill(`SYN-${String(index)}`);
          await page
            .locator(`#instalments-${String(index)}-cheque-bankName`)
            .fill("Synthetic Bank");
        }
        await page
          .getByRole("button", { name: t.Contracts.saveDraft, exact: true })
          .click();
        await expect(page).toHaveURL(/\/contracts\/[a-f0-9-]{36}$/);
        contractPath = new URL(page.url()).pathname;
        await page
          .getByRole("button", { name: t.Approvals.submit, exact: true })
          .click();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: t.Approvals.confirm, exact: true })
          .click();
        await expect(
          page.getByText(t.Status.contract.awaiting_owner_approval, {
            exact: true,
          }),
        ).toBeVisible();
        submitted = true;
      });
      await stage("J5 owner approval and tenant acceptance", async () => {
        if (!submitted || !ownerPage || !tenantPage)
          throw new Error("J4 did not submit a contract with linked parties");
        for (const [actor, action] of [
          [ownerPage, t.Approvals.approve_owner],
          [tenantPage, t.Approvals.accept_tenant],
        ] as const) {
          await actor.goto(contractPath);
          await actor
            .getByRole("button", {
              name: action.replace("{version}", "1"),
              exact: true,
            })
            .click();
          await actor
            .getByRole("dialog")
            .getByRole("button", { name: t.Approvals.confirm, exact: true })
            .click();
          await expect(
            actor.getByText(t.Approvals.done, { exact: true }),
          ).toBeVisible();
        }
        await page.goto(contractPath);
        await expect(
          page.getByText(t.Status.contract.concluded, { exact: true }),
        ).toBeVisible();
        concluded = true;
      });
      await stage(
        "J6 certificate upload and discrepancy resolution",
        async () => {
          if (!concluded) throw new Error("J5 did not conclude a contract");
          if (!certificate)
            throw new Error(
              "The synthetic dataset has no Tawtheeq certificate",
            );
          await page.goto(`${base()}/tawtheeq`);
          await page.locator('tbody a[href*="/tawtheeq/"]').first().click();
          await page
            .getByLabel(t.Tawtheeq.uploadLabel, { exact: true })
            .setInputFiles(resolve(dataset, certificate.image));
          await page
            .getByRole("button", { name: t.Tawtheeq.upload, exact: true })
            .click();
          await expect(
            page.getByRole("heading", {
              name: t.Tawtheeq.reviewTitle,
              exact: true,
            }),
          ).toBeVisible({ timeout: 120_000 });
          for (const key of [
            "tawtheeq_number",
            "registered_on",
            "unt_number",
            "owner_id_number",
            "tenant_id_number",
          ])
            await page
              .getByTestId(`review-${key}`)
              .getByRole("checkbox")
              .check();
          await page
            .getByRole("button", { name: t.Tawtheeq.reviewSubmit, exact: true })
            .click();
          const discrepancy = page
            .locator("tr[data-field]")
            .filter({ has: page.locator('option[value="adopt"]') })
            .first();
          await expect(discrepancy).toBeVisible();
          await discrepancy.getByRole("combobox").first().selectOption("adopt");
          await discrepancy
            .getByRole("textbox")
            .fill(
              locale === "ar"
                ? "مطابقة الوثيقة التجريبية"
                : "Confirmed against the synthetic source",
            );
          await page
            .getByRole("button", {
              name: t.Tawtheeq.resolve.replace("{count}", "1"),
              exact: true,
            })
            .click();
          await expect(
            page.getByRole("heading", { name: t.Tawtheeq.adoptionTitle }),
          ).toBeVisible();
        },
      );
      await stage("J7 audit history and chain verification", async () => {
        if (!companyId) throw new Error("J1 did not create a company");
        await page.goto(`${base()}/audit`);
        await page
          .getByRole("button", { name: t.Audit.verify, exact: true })
          .click();
        await expect(
          page.getByText(t.Audit.verified, { exact: true }),
        ).toBeVisible();
        await expect(page.locator("tbody tr").first()).toBeVisible();
      });
    } finally {
      await testInfo.attach(`${locale}-journey-results`, {
        body: JSON.stringify(results, null, 2),
        contentType: "application/json",
      });
      for (const context of contexts) await context.close();
    }
  });
}
