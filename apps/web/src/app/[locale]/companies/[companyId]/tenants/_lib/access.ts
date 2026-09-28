import "server-only";
import { isLocale, type Locale } from "@aqarak/i18n";
import {
  getCurrentSession,
  requireCompanyContext,
} from "@/lib/session/session";
import { isSectionPermitted } from "@/lib/navigation/sections";
import type {
  Access,
  J3Client,
  Outcome,
  TenantDetail,
  VersionRef,
} from "./j3-contract";

export async function authorize(
  locale: string,
  companyId: string,
): Promise<Outcome<{ access: Access; locale: Locale }>> {
  if (!isLocale(locale)) return { ok: false, code: "NOT_FOUND" };
  try {
    const session = await getCurrentSession();
    if (!session) return { ok: false, code: "SESSION_INVALID" };
    if (!session.me.contexts.some((item) => item.companyId === companyId))
      return { ok: false, code: "NOT_FOUND" };
    const context = await requireCompanyContext(locale, companyId);
    if (!isSectionPermitted(context, "tenants"))
      return { ok: false, code: "FORBIDDEN" };
    return {
      ok: true,
      access: { sessionId: session.sessionId, companyId },
      locale,
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}
export async function ownedVersion(
  client: J3Client,
  access: Access,
  tenantId: string,
  ref: VersionRef,
): Promise<Outcome<{ tenant: TenantDetail }>> {
  const result = await client.getTenant(access, tenantId);
  if (!result.ok) return result;
  const belongs = result.tenant.checklist.some(
    (item) =>
      item.documentId === ref.documentId &&
      (item.latestVersionId === ref.versionId ||
        item.currentVersionId === ref.versionId),
  );
  return belongs ? result : { ok: false, code: "NOT_FOUND" };
}
