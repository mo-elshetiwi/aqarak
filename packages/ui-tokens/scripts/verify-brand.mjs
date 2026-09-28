/* global document, getComputedStyle, localStorage, window */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import process from "node:process";
import { URL } from "node:url";
import { colorTokens } from "../src/index.ts";
import { signIn } from "../../../apps/web/e2e/helpers.ts";

const webRequire = createRequire(
  new URL("../../../apps/web/package.json", import.meta.url),
);
const { chromium } = webRequire("@playwright/test");
const baseURL = process.env.BRAND_BASE_URL ?? "http://127.0.0.1:3171";
assert.equal(new URL(baseURL).hostname, "127.0.0.1");
const output = new URL("../output/playwright/", import.meta.url);
mkdirSync(output, { recursive: true });

async function checkMark(page, locale, theme, size) {
  const mark = page.locator('header [data-slot="brand-mark"]');
  assert.equal(await mark.count(), 1);
  assert.equal(await mark.innerText(), locale === "ar" ? "عقارك" : "Aqarak");
  const visible = mark.locator("img:visible");
  assert.equal(await visible.count(), 1);
  assert.equal(
    await visible.getAttribute("src"),
    `/brand/aqarak-icon-${theme === "light" ? "ink" : "cream"}.svg`,
  );
  assert.equal(await visible.getAttribute("alt"), "");
  await visible.evaluate((element) => element.decode());
  const box = await visible.boundingBox();
  assert.equal(box?.width, size);
  assert.equal(box?.height, size);
}

async function capture(page, filename) {
  await page.screenshot({
    path: new URL(filename, output).pathname,
    fullPage: true,
  });
}

const browser = await chromium.launch();
try {
  for (const locale of ["en", "ar"]) {
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({
        baseURL,
        colorScheme: theme === "light" ? "dark" : "light",
      });
      await context.addInitScript(
        (value) => localStorage.setItem("aqarak-theme", value),
        theme,
      );
      const page = await context.newPage();
      await page.goto(`/${locale}/sign-in`);
      await checkMark(page, locale, theme, 40);
      for (const asset of [
        "/favicon.svg",
        "/icon-32.png",
        "/apple-touch-icon.png",
      ]) {
        assert.equal((await context.request.get(asset)).status(), 200);
        assert.equal(
          await page.locator(`head link[href="${asset}"]`).count(),
          1,
        );
      }
      await capture(page, `sign-in-${locale}-${theme}.png`);
      await signIn(page, "manager-1", locale);
      await checkMark(page, locale, theme, 24);
      await capture(page, `shell-${locale}-${theme}.png`);
      await page.setViewportSize({ width: 390, height: 844 });
      await checkMark(page, locale, theme, 24);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
      );
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/${locale}/showcase`);
      assert.equal(
        await page
          .locator("body")
          .evaluate((element) =>
            getComputedStyle(element)
              .getPropertyValue("--background")
              .trim()
              .toUpperCase(),
          ),
        colorTokens[theme].background,
      );
      await capture(page, `showcase-${locale}-${theme}.png`);
      await context.close();
      process.stdout.write(
        `${locale} ${theme}: sign-in 40 px, shell 24 px, narrow shell, icons and showcase passed\n`,
      );
    }
  }
  const context = await browser.newContext({ baseURL, colorScheme: "light" });
  const page = await context.newPage();
  await page.goto("/en/sign-in");
  await checkMark(page, "en", "light", 40);
  await page.emulateMedia({ colorScheme: "dark" });
  await checkMark(page, "en", "dark", 40);
  await context.close();
  process.stdout.write(
    "System appearance: mark follows light and dark preferences\n",
  );
} finally {
  await browser.close();
}
