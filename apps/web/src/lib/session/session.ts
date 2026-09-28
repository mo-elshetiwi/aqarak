import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Locale } from "@aqarak/i18n";
import { getApi } from "../api";
import { sessionIdSchema, type CompanyContext, type Me } from "../api/contract";
import { SESSION_COOKIE } from "./cookie";
import { csrfTokenFor } from "./csrf";

export interface CurrentSession {
  sessionId: string;
  me: Me;
  csrfToken: string;
}
/** Memoizes current permissions only within the current server render. */
export const getCurrentSession = cache(
  async (): Promise<CurrentSession | null> => {
    const sessionId = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!sessionId || !sessionIdSchema.safeParse(sessionId).success)
      return null;
    const result = await getApi().getMe(sessionId);
    if (!result.ok) {
      if (result.error.code === "SESSION_INVALID") return null;
      throw new Error("Session API unavailable");
    }
    return { sessionId, me: result.value, csrfToken: csrfTokenFor(sessionId) };
  },
);
/** Refuses unauthenticated server rendering even when the proxy is bypassed. */
export async function requireSession(locale: Locale): Promise<CurrentSession> {
  const session = await getCurrentSession();
  if (!session) redirect(`/${locale}/sign-in`);
  return session;
}
/** Resolves only a company context explicitly granted by the current API response. */
export async function requireCompanyContext(
  locale: Locale,
  companyId: string,
): Promise<CompanyContext> {
  const session = await requireSession(locale);
  const context = session.me.contexts.find(
    (item) => item.companyId === companyId,
  );
  if (!context) notFound();
  return context;
}
