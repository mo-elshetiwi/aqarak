import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  MOCK_CONFIRMATION_CODE,
  MOCK_ONLY_PASSWORD,
} from "../src/lib/api/mock-fixtures";
import { expectNavigation } from "./helpers";
test("AC-9 signs up, confirms, signs in and creates a management company without email in URLs", async ({
  page,
}) => {
  const email = `synthetic-${randomUUID()}@example.com`;
  const visited: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) visited.push(frame.url());
  });
  await page.goto("/en/sign-up");
  await page.locator("#fullName").fill("Synthetic Registration");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(MOCK_ONLY_PASSWORD);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL("/en/verify");
  await expect(page.locator("#email")).toHaveValue(email);
  await page.locator("#code").fill(MOCK_CONFIRMATION_CODE);
  await page
    .getByRole("button", { name: "Confirm email", exact: true })
    .click();
  await expect(page).toHaveURL("/en/sign-in?confirmed=1");
  await expect(page.getByRole("status")).toHaveText(
    "Your email is confirmed. Sign in to continue.",
  );
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(MOCK_ONLY_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("/en/setup/company");
  await page.locator("#nameEn").fill("Synthetic Registration Properties");
  await page.locator("#nameAr").fill("عقارات التسجيل التجريبية");
  await page.locator("#tradeLicenceNumber").fill("SYNTHETIC-246810");
  await page
    .getByRole("button", { name: "Create company", exact: true })
    .click();
  await expect(page).toHaveURL(/\/en\/companies\/[a-f0-9-]+\/home$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Home");
  await expectNavigation(page, "admin-1");
  expect(visited.length).toBeGreaterThanOrEqual(5);
  for (const url of visited)
    expect(decodeURIComponent(url)).not.toContain(email);
});
