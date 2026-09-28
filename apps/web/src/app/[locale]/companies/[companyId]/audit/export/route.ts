import { z } from "zod";
import { getCurrentSession } from "@/lib/session/session";
import { checkRequestOrigin } from "@/lib/session/origin";
import { verifyCsrfToken } from "@/lib/session/csrf";
import { canReadAudit, getAuditClient } from "../_lib/client";
import { filtersSchema } from "../_lib/schemas";
function problem(status: number, code: string): Response {
  return Response.json(
    { code },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
function sameOrigin(request: Request): boolean {
  if (request.headers.has("origin")) return checkRequestOrigin(request);
  // I require fetch metadata and CSRF for browser GETs, which omit Origin.
  const referrer = request.headers.get("referer");
  if (request.headers.get("sec-fetch-site") !== "same-origin" || !referrer)
    return false;
  const headers = new Headers(request.headers);
  headers.set("origin", new URL(referrer).origin);
  return checkRequestOrigin(new Request(request.url, { headers }));
}
export async function GET(
  request: Request,
  context: { params: Promise<{ companyId: string }> },
): Promise<Response> {
  try {
    if (!sameOrigin(request)) return problem(403, "FORBIDDEN_ORIGIN");
    const session = await getCurrentSession();
    if (!session) return problem(401, "SESSION_INVALID");
    if (
      !request.headers.has("origin") &&
      !verifyCsrfToken(session.sessionId, request.headers.get("x-aqarak-csrf"))
    )
      return problem(403, "CSRF_INVALID");
    const { companyId } = await context.params;
    if (!z.uuid().safeParse(companyId).success)
      return problem(422, "VALIDATION_FAILED");
    const company = session.me.contexts.find((c) => c.companyId === companyId);
    if (!company || !canReadAudit(company))
      return problem(403, "NOT_PERMITTED");
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some((key) => query.getAll(key).length !== 1))
      return problem(422, "VALIDATION_FAILED");
    const filters = filtersSchema.strict().safeParse(Object.fromEntries(query));
    if (!filters.success) return problem(422, "VALIDATION_FAILED");
    const result = await getAuditClient(companyId, session.sessionId).exportCsv(
      filters.data,
    );
    if (!result.ok) return problem(result.error.status, result.error.code);
    return new Response(result.value.body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": result.value.disposition,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return problem(503, "UNAVAILABLE");
  }
}
