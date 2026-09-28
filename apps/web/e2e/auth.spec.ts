import { expect, test } from "@playwright/test";
import { getMessages } from "./catalogues";
import { MOCK_ACCOUNTS, MOCK_COMPANY_A_ID } from "../src/lib/api/mock-fixtures";
import { expectNavigation, signIn } from "./helpers";
for (const locale of ["en", "ar"] as const) {
  test(`AC-1/AC-2 ${locale} signs in with protected cookies and the manager navigation`, async ({
    page,
    context,
  }) => {
    await signIn(page, "manager-1", locale);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      getMessages(locale).Navigation.sections.home,
    );
    await expectNavigation(page, "manager-1", locale);
    await expect(page.locator("html")).toHaveAttribute(
      "dir",
      locale === "ar" ? "rtl" : "ltr",
    );
    const browser = await page.evaluate(() => ({
      cookie: document.cookie,
      local: Object.fromEntries(
        Object.keys(localStorage).map((key) => [
          key,
          localStorage.getItem(key),
        ]),
      ),
      session: Object.fromEntries(
        Object.keys(sessionStorage).map((key) => [
          key,
          sessionStorage.getItem(key),
        ]),
      ),
    }));
    expect(browser.cookie).not.toContain("aqarak-sid");
    const cookie = (await context.cookies()).find(
      (item) => item.name === "__Host-aqarak-sid",
    );
    expect(
      cookie,
      "Secure host cookie must be accepted without weakening its attributes",
    ).toBeDefined();
    expect(cookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
    });
    if (!cookie) throw new Error("Chromium refused the secure host cookie");
    expect(JSON.stringify(browser.local)).not.toContain(cookie.value);
    expect(JSON.stringify(browser.session)).not.toContain(cookie.value);
    expect(JSON.stringify(browser.local)).not.toContain("aqarak-sid");
    expect(JSON.stringify(browser.session)).not.toContain("aqarak-sid");
    if (locale === "ar") {
      const bounds = await page.getByTestId("desktop-sidebar").boundingBox();
      expect(bounds?.x).toBeGreaterThan((page.viewportSize()?.width ?? 0) / 2);
    }
  });
}
test("AC-3 incorrect credentials focus the summary and retain the email", async ({
  page,
}) => {
  const account = MOCK_ACCOUNTS.find((item) => item.handle === "manager-1");
  if (!account) throw new Error("Missing fixture");
  await page.goto("/en/sign-in");
  await page.locator("#email").fill(account.email);
  await page.locator("#password").fill("Wrong-synthetic-123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Check the following fields" }),
  ).toBeFocused();
  await expect(
    page.getByRole("alert").filter({ hasText: "Check the following fields" }),
  ).toContainText("The email or password is not correct.");
  await expect(page.locator("#email")).toHaveValue(account.email);
});
test("AC-4 sign-out revokes the session and preserves only the return path", async ({
  page,
}) => {
  await signIn(page);
  await page
    .getByTestId("desktop-sidebar")
    .getByText("More", { exact: true })
    .click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL("/en/sign-in");
  const home = `/en/companies/${MOCK_COMPANY_A_ID}/home`;
  await page.goto(home);
  await expect(page).toHaveURL(`/en/sign-in?next=${encodeURIComponent(home)}`);
});
test("AC-5 rejects an attacker origin without revoking the session", async ({
  page,
}) => {
  await signIn(page);
  const response = await page.request.post("/api/auth/sign-out", {
    headers: { Origin: "https://attacker.example" },
    data: { locale: "en" },
  });
  expect(response.status()).toBe(403);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Home");
});

test("sign-in responses carry the standard security headers", async ({
  page,
}) => {
  const response = await page.goto("/en/sign-in");
  expect(response?.headers()).toMatchObject({
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
    "content-security-policy":
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
    "permissions-policy":
      "camera=(self), microphone=(self), geolocation=(), payment=()",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
  });
});
