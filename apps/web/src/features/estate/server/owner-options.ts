import type { Result } from "@aqarak/domain";
import { err, ok } from "@aqarak/domain";
import type { EstateProblem, OwnerListItem } from "../contract";
import type { EstateApi } from "./estate-api";
/** I collect every page so an owner remains selectable beyond the first hundred records. */
export async function ownerOptions(
  api: EstateApi,
  sessionId: string,
  companyId: string,
): Promise<Result<OwnerListItem[], EstateProblem>> {
  const items: OwnerListItem[] = [];
  const visited = new Set<string>();
  let cursor: string | undefined;
  do {
    const result = await api.listOwners(sessionId, companyId, {
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    if (!result.ok) return result;
    items.push(...result.value.items);
    const next = result.value.nextCursor;
    if (next === null) return ok(items);
    if (visited.has(next)) return err({ status: 503, code: "UNAVAILABLE" });
    visited.add(next);
    cursor = next;
  } while (cursor);
  return ok(items);
}
