import { execFileSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import type { Locale } from "@aqarak/i18n";
import { getMessages } from "../e2e/catalogues";
export async function register(
  ...[page, locale, email, password, fullName = "Synthetic Journey Member"]: [
    Page,
    Locale,
    string,
    string,
    string?,
  ]
): Promise<void> {
  const t = getMessages(locale).Auth;
  await page.locator("#fullName").fill(fullName);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: t.signUp, exact: true }).click();
  await expect(page).toHaveURL(`/${locale}/verify`);
  if (process.env.AQARAK_DEPLOYED_JOURNEY === "1") {
    if (process.env.AQARAK_CONFIRM_SYNTHETIC_USERS !== "1")
      throw new Error(
        "Cognito confirmation requires a real code or approved synthetic-user setup",
      );
    const pool = process.env.AQARAK_DEV_USER_POOL_ID;
    if (
      !pool?.startsWith("us-east-1_") ||
      !/^journey-(manager|owner|tenant)-[a-f0-9-]+@dev\.aqarak\.ae$/u.test(
        email,
      )
    )
      throw new Error("Only synthetic dev journey users may be confirmed");
    const common = [
      "--region",
      "us-east-1",
      "--user-pool-id",
      pool,
      "--username",
      email,
    ];
    execFileSync("aws", ["cognito-idp", "admin-confirm-sign-up", ...common], {
      stdio: "pipe",
    });
    execFileSync(
      "aws",
      [
        "cognito-idp",
        "admin-update-user-attributes",
        ...common,
        "--user-attributes",
        "Name=email_verified,Value=true",
      ],
      { stdio: "pipe" },
    );
    await page.goto(`/${locale}/sign-in?confirmed=1`);
    return;
  }
  await page.locator("#code").fill("246810");
  await page.getByRole("button", { name: t.verify, exact: true }).click();
  await expect(page).toHaveURL(`/${locale}/sign-in?confirmed=1`);
}
export async function signIn(
  page: Page,
  locale: Locale,
  email: string,
  password: string,
): Promise<void> {
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page
    .getByRole("button", { name: getMessages(locale).Auth.signIn, exact: true })
    .click();
}
export async function signOut(page: Page, locale: Locale): Promise<void> {
  const t = getMessages(locale).Shell;
  await page
    .getByTestId("desktop-sidebar")
    .getByText(t.more, { exact: true })
    .click();
  await page.getByRole("button", { name: t.signOut, exact: true }).click();
  await expect(page).toHaveURL(`/${locale}/sign-in`);
}
export async function accessibility(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const violations = result.violations.filter(
    (item) => item.impact === "serious" || item.impact === "critical",
  );
  expect(
    violations.map((item) => ({ id: item.id, impact: item.impact })),
  ).toEqual([]);
}
