import "server-only";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  getCurrentSession,
  requireCompanyContext,
} from "@/lib/session/session";
import {
  actionContextSchema,
  idSchema,
  type ActionContext,
  type EstateActionResult,
} from "../contract";
import { getEstateApi } from "./estate-api";
import { routes, type Input, type Output, type RouteName } from "./routes";
import type { Result } from "@aqarak/domain";
import type { EstateProblem } from "../contract";

export async function runCommand<K extends RouteName>(
  name: K,
  context: ActionContext,
  input: Input<K>,
  ids: string[] = [],
): Promise<EstateActionResult<Output<K>>> {
  const scope = actionContextSchema.safeParse(context);
  if (!scope.success) return { ok: false, code: "VALIDATION_FAILED" };
  try {
    const session = await getCurrentSession();
    if (!session) return { ok: false, code: "FORBIDDEN" };
    if (
      !session.me.contexts.some(
        (item) => item.companyId === scope.data.companyId,
      )
    )
      return { ok: false, code: "FORBIDDEN" };
    const company = await requireCompanyContext(
      scope.data.locale,
      scope.data.companyId,
    );
    if (!company.staffRoles.includes("manager"))
      return { ok: false, code: "FORBIDDEN" };
    const parsed = routes[name].input.safeParse(input);
    if (!z.array(idSchema).length(commandIdCount(name)).safeParse(ids).success)
      return { ok: false, code: "VALIDATION_FAILED" };
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue?.path.reduce<string>(
        (path, part) =>
          typeof part === "number"
            ? `${path}[${String(part)}]`
            : path
              ? `${path}.${String(part)}`
              : String(part),
        "",
      );
      return {
        ok: false,
        code: "VALIDATION_FAILED",
        ...(field ? { field } : {}),
      };
    }
    const method = getEstateApi()[name] as (
      ...args: [
        session: string,
        company: string,
        input: Input<K>,
        ids: string[],
        key: string,
      ]
    ) => Promise<Result<Output<K>, EstateProblem>>;
    const result = await method(
      session.sessionId,
      scope.data.companyId,
      parsed.data as Input<K>,
      ids,
      scope.data.idempotencyKey,
    );
    if (!result.ok)
      return {
        ok: false,
        code: result.error.code,
        ...(result.error.field ? { field: result.error.field } : {}),
      };
    const base = `/${scope.data.locale}/companies/${scope.data.companyId}`;
    revalidatePath(`${base}/owners`, "layout");
    revalidatePath(`${base}/properties`, "layout");
    return { ok: true, data: result.value };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

function commandIdCount(name: RouteName): number {
  if (name.includes("Document")) return 3;
  if (name === "updateUnit" || name === "changeUnitStatus") return 2;
  return name === "createOwner" || name === "createProperty" ? 0 : 1;
}
