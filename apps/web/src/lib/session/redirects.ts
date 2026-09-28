import type { Locale } from "@aqarak/i18n";
import type { Me } from "../api/contract";
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 32 || code === 127) return true;
  }
  return false;
}
/** Accepts only local navigation within the active language. */
export function safeNextPath(
  locale: Locale,
  candidate: unknown,
): string | null {
  if (typeof candidate !== "string" || !candidate.startsWith(`/${locale}/`))
    return null;
  let decoded = candidate;
  try {
    for (let pass = 0; pass < 5 && decoded.includes("%"); pass++)
      decoded = decodeURIComponent(decoded);
  } catch {
    return null;
  }
  if (
    !decoded.startsWith(`/${locale}/`) ||
    /\/\/|\\|:|%/.test(decoded) ||
    hasControlCharacter(decoded) ||
    decoded.split(/[/?#]/).includes("..")
  )
    return null;
  return candidate;
}
/** Chooses the first page from the account's current API contexts. */
export function landingPathFor(locale: Locale, me: Me): string {
  const [context] = me.contexts;
  if (!context) return `/${locale}/setup/company`;
  if (me.contexts.length === 1)
    return `/${locale}/companies/${context.companyId}/home`;
  return `/${locale}/companies`;
}
