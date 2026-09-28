import "server-only";
import { notFound, redirect } from "next/navigation";
import { isLocale } from "@aqarak/i18n";
import {
  getCurrentSession,
  requireCompanyContext,
} from "@/lib/session/session";
import { isSectionPermitted } from "@/lib/navigation/sections";
import { getJ3Client } from "./j3";
import { ownedVersion } from "./access";
import type {
  Access,
  Outcome,
  TenantDetail,
  VersionDetail,
} from "./j3-contract";
import type { ReviewRoute } from "./routes";
export async function pageAccess(route: {
  locale: string;
  companyId: string;
}): Promise<Outcome<{ access: Access }>> {
  if (!isLocale(route.locale)) notFound();
  const context = await requireCompanyContext(route.locale, route.companyId);
  const session = await getCurrentSession();
  if (!session) redirect(`/${route.locale}/sign-in`);
  if (!isSectionPermitted(context, "tenants"))
    return { ok: false, code: "FORBIDDEN" };
  return {
    ok: true,
    access: { sessionId: session.sessionId, companyId: route.companyId },
  };
}
export function hideMissing<T>(result: Outcome<T>): Outcome<T> {
  if (!result.ok && result.code === "NOT_FOUND") notFound();
  return result;
}
export async function loadReview(
  route: ReviewRoute,
): Promise<
  Outcome<{ tenant: TenantDetail; version: VersionDetail; access: Access }>
> {
  const auth = await pageAccess(route);
  if (!auth.ok) return auth;
  const client = getJ3Client();
  const tenant = hideMissing(
    await ownedVersion(client, auth.access, route.tenantId, route),
  );
  if (!tenant.ok) return tenant;
  const version = hideMissing(await client.getVersion(auth.access, route));
  if (version.ok && !version.version.uploadedAt)
    return { ok: false, code: "INVALID_STATE" };
  return version.ok
    ? {
        ok: true,
        tenant: tenant.tenant,
        version: version.version,
        access: auth.access,
      }
    : version;
}
