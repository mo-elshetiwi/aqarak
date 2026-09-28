import { describe, expect, it } from "vitest";
import { getMessages, locales } from "@aqarak/i18n";
import { emailTemplates, renderNotificationEmail } from "../render";
const input = {
  companyName: {
    en: "Example Company (synthetic)",
    ar: "شركة تجريبية (synthetic)",
  },
  contractNo: "C-١٢",
  companyId: "company-id",
  contractId: "contract-id",
  appOrigin: "https://example.invalid/",
};
describe("notification email copy", () => {
  for (const locale of locales)
    it.each(emailTemplates)(`renders minimal ${locale} %s copy`, (template) => {
      const result = renderNotificationEmail({ ...input, locale, template });
      const link = `https://example.invalid/${locale}/companies/company-id/contracts/contract-id`;
      expect(result.text).toContain(input.companyName[locale]);
      expect(result.text).toContain("C-12");
      expect(result.text.endsWith(link)).toBe(true);
      expect(result.html).toContain(
        `lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"`,
      );
      expect(result.html).toContain(`href="${link}"`);
      expect(result.subject + result.text + result.html).not.toMatch(
        /\d{15}|AED|\d+[.,]\d{2}|[٠-٩۰-۹]|Synthetic Owner|Synthetic Tenant/u,
      );
      expect(result.text).not.toMatch(/token=|code=|signature=|2026|2027/u);
    });
  it("uses identical bilingual key paths", () => {
    const paths = (value: object, prefix = ""): string[] =>
      Object.entries(value as Record<string, unknown>)
        .flatMap(([key, child]) =>
          typeof child === "object" && child !== null
            ? paths(child, `${prefix}${key}.`)
            : [`${prefix}${key}`],
        )
        .sort();
    expect(paths(getMessages("en").Notifications)).toEqual(
      paths(getMessages("ar").Notifications),
    );
  });
  it("escapes company text and strips subject line breaks", () => {
    const result = renderNotificationEmail({
      ...input,
      locale: "en",
      template: "contract_cancelled",
      companyName: { en: '<script>"&', ar: "شركة" },
    });
    expect(result.html).toContain("&lt;script&gt;&quot;&amp;");
    expect(result.html).not.toContain("<script>");
  });
  it.each([
    "javascript:alert(1)",
    "https://user:password@example.invalid",
    "https://example.invalid/action?token=x",
  ])("rejects a non-origin link base %s", (appOrigin) => {
    expect(() =>
      renderNotificationEmail({
        ...input,
        appOrigin,
        locale: "en",
        template: "contract_cancelled",
      }),
    ).toThrow();
  });
});
