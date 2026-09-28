import { isMockApi } from "@/lib/api";
import { authorize } from "@/app/[locale]/companies/[companyId]/tenants/_lib/access";
import {
  getMockFile,
  markMockUpload,
} from "@/app/[locale]/companies/[companyId]/tenants/_lib/j3-mock";
interface Context {
  params: Promise<{ locale: string; companyId: string; versionId: string }>;
}
export async function PUT(
  request: Request,
  context: Context,
): Promise<Response> {
  if (!isMockApi()) return new Response(null, { status: 404 });
  const route = await context.params;
  const auth = await authorize(route.locale, route.companyId);
  if (!auth.ok) return new Response(null, { status: 404 });
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!["image/jpeg", "image/png", "application/pdf"].includes(contentType))
    return new Response(null, { status: 415 });
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > 20 * 1024 * 1024)
    return new Response(null, { status: 413 });
  return new Response(null, {
    status: markMockUpload(route.versionId, bytes, contentType) ? 200 : 404,
  });
}
export async function GET(
  _request: Request,
  context: Context,
): Promise<Response> {
  if (!isMockApi()) return new Response(null, { status: 404 });
  const route = await context.params;
  const auth = await authorize(route.locale, route.companyId);
  if (!auth.ok) return new Response(null, { status: 404 });
  const file = getMockFile(route.versionId);
  if (!file) return new Response(null, { status: 404 });
  return new Response(file.bytes, {
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
