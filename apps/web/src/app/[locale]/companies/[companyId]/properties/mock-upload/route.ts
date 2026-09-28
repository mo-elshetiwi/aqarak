import { isMockApi } from "@/lib/api";
import {
  estatePageContext,
  type EstatePageParams,
} from "@/features/estate/server/page-context";
/** I discard synthetic upload bytes without reading or persisting a document. */
export async function PUT(
  _request: Request,
  { params }: { params: Promise<EstatePageParams> },
): Promise<Response> {
  if (!isMockApi()) return new Response(null, { status: 404 });
  const page = await estatePageContext(await params);
  return new Response(null, {
    status: page.manager ? 204 : 403,
    headers: { "Cache-Control": "no-store" },
  });
}
