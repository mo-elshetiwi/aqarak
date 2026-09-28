import { expect, type Page } from "@playwright/test";
import type { Locale } from "@aqarak/i18n";
import { getMessages } from "./catalogues";
import {
  MOCK_ACCOUNTS,
  MOCK_ONLY_PASSWORD,
  MOCK_COMPANY_A_ID,
} from "../src/lib/api/mock-fixtures";
export const expectedIds = {
  "manager-1":
    "home inbox owners properties tenants contracts tawtheeq money maintenance documents tasks dashboard audit co-worker",
  "owner-1": "home inbox portfolio statements maintenance documents co-worker",
  "tenant-1": "home inbox tenancy payments maintenance documents co-worker",
  "technician-1": "home inbox co-worker",
  "admin-1":
    "home inbox members settings templates ai-usage audit export co-worker",
  "accountant-1":
    "home inbox schedules payments-receipts invoices charges arrears statements-payouts audit co-worker",
  "owner-2":
    "home inbox owners properties tenants contracts tawtheeq money portfolio statements maintenance documents tasks dashboard members settings templates ai-usage audit export co-worker",
} as const;
export async function signIn(
  page: Page,
  handle = "manager-1",
  locale: Locale = "en",
): Promise<void> {
  const account = MOCK_ACCOUNTS.find((item) => item.handle === handle);
  if (!account) throw new Error("Missing synthetic account");
  await page.goto(`/${locale}/sign-in`);
  await page.locator("#email").fill(account.email);
  await page.locator("#password").fill(MOCK_ONLY_PASSWORD);
  await page
    .getByRole("button", { name: getMessages(locale).Auth.signIn, exact: true })
    .click();
  await expect(page).toHaveURL(
    handle === "owner-2"
      ? `/${locale}/companies`
      : `/${locale}/companies/${MOCK_COMPANY_A_ID}/home`,
  );
}
export async function expectNavigation(
  page: Page,
  handle: keyof typeof expectedIds,
  locale: Locale = "en",
): Promise<void> {
  const messages = getMessages(locale);
  const labels: Record<string, string> = messages.Navigation.sections;
  const expected = expectedIds[handle].split(" ").map((id) => {
    const label = labels[id];
    if (!label) throw new Error(`Missing section label ${id}`);
    return label;
  });
  const navigation = page
    .getByTestId("desktop-sidebar")
    .getByRole("navigation", { name: messages.Shell.navigation });
  await expect(navigation.getByRole("link")).toHaveText(expected);
}
