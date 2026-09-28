import { getDirection, getMessages, type Locale } from "@aqarak/i18n";
export const emailTemplates = [
  "contract_approval_requested",
  "contract_cancelled",
  "contract_concluded",
] as const;
export type EmailTemplate = (typeof emailTemplates)[number];
export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}
function westernDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/gu, (digit) =>
    String(digit.charCodeAt(0) - (digit <= "٩" ? 0x660 : 0x6f0)),
  );
}
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}
export function renderNotificationEmail(input: {
  template: EmailTemplate;
  locale: Locale;
  companyName: { en: string; ar: string };
  contractNo: string;
  companyId: string;
  contractId: string;
  appOrigin: string;
}): EmailContent {
  const origin = new URL(input.appOrigin);
  if (
    !["https:", "http:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new Error("Invalid application origin");
  const link = `${origin.origin}/${input.locale}/companies/${encodeURIComponent(input.companyId)}/contracts/${encodeURIComponent(input.contractId)}`;
  const values: Record<string, string> = {
    companyName: westernDigits(input.companyName[input.locale]),
    contractNo: westernDigits(input.contractNo),
    link,
  };
  const copy = getMessages(input.locale).Notifications.email[input.template];
  const interpolate = (value: string): string =>
    value.replace(
      /\{(companyName|contractNo|link)\}/gu,
      (_match, key: string) => values[key] ?? "",
    );
  const subject = interpolate(copy.subject).replace(/[\r\n]+/gu, " ");
  const text = interpolate(copy.body);
  const html = `<!doctype html><html lang="${input.locale}" dir="${getDirection(input.locale)}"><body><p>${escapeHtml(
    text,
  )
    .replaceAll("\n", "<br>")
    .replace(
      escapeHtml(link),
      `<a href="${escapeHtml(link)}">${escapeHtml(link)}</a>`,
    )}</p></body></html>`;
  return { subject, text, html };
}
