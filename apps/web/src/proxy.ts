import createMiddleware from "next-intl/middleware";
import { isLocale } from "@aqarak/i18n";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { SESSION_COOKIE } from "./lib/session/cookie";
const localeMiddleware = createMiddleware(routing);
/** Resolves locale navigation after a presence-only check for protected pages. */
export function proxy(
  request: NextRequest,
): ReturnType<typeof localeMiddleware> {
  const [, locale, section] = request.nextUrl.pathname.split("/");
  if (
    isLocale(locale) &&
    (section === "companies" || section === "setup") &&
    !request.cookies.get(SESSION_COOKIE)?.value
  ) {
    const target = new URL(`/${locale}/sign-in`, request.url);
    target.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(target);
  }
  return localeMiddleware(request);
}
/** Limits locale routing to pages rather than services or static files. */
export const config = { matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"] };
