import { test, expect } from "@playwright/test";
test("English pages set English language and left-to-right direction", async ({
  page,
}) => {
  await page.goto("/en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
});
test("Arabic pages set Arabic language and right-to-left direction", async ({
  page,
}) => {
  await page.goto("/ar");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});
test("English language preference redirects the root to English", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({ "Accept-Language": "en" });
  await page.goto("/");
  await expect(page).toHaveURL("/en");
});
test("language link includes both labels and switches between both locales", async ({
  page,
}) => {
  await page.goto("/en");
  const arabicLink = page.getByRole("link", {
    name: "Change language العربية",
    exact: true,
  });
  await expect(arabicLink).toHaveAttribute("href", "/ar");
  await expect(arabicLink).toHaveAttribute("hreflang", "ar");
  await expect(arabicLink).not.toHaveAttribute("aria-label");
  await expect(arabicLink).not.toHaveAttribute("role");
  await expect(
    arabicLink.getByText("العربية", { exact: true }),
  ).toHaveAttribute("lang", "ar");
  const size = await arabicLink.boundingBox();
  expect(size?.width).toBeGreaterThanOrEqual(24);
  expect(size?.height).toBeGreaterThanOrEqual(40);
  await arabicLink.click();
  await expect(page).toHaveURL("/ar");
  const englishLink = page.getByRole("link", {
    name: "تغيير اللغة English",
    exact: true,
  });
  await expect(englishLink).toHaveAttribute("href", "/en");
  await expect(englishLink).toHaveAttribute("hreflang", "en");
  await expect(
    englishLink.getByText("English", { exact: true }),
  ).toHaveAttribute("lang", "en");
  await englishLink.click();
  await expect(page).toHaveURL("/en");
});
