import { z } from "zod";
import { err, ok, type Result } from "@aqarak/domain";
import {
  problemCodeSchema,
  keySchema,
  type EstateProblem,
  type EstateProblemCode,
} from "../contract";
import type { EstateApi } from "./estate-api";
import { bindApi } from "./bind";
import { routes, type Input, type Output, type RouteName } from "./routes";

// This check mirrors apps/web/src/lib/api/index.ts because apiBaseUrl is private.
function validateBaseUrl(value: string): string {
  try {
    if (!value) throw new Error();
    const url = new URL(value);
    const loopback =
      url.hostname === "localhost" ||
      url.hostname === "[::1]" ||
      /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
    if (
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url.href.replace(/\/$/, "");
  } catch {
    throw new Error(
      "AQARAK_API_BASE_URL must be an HTTPS URL or an HTTP loopback URL",
    );
  }
}
function fallback(status: number): EstateProblemCode {
  const codes: Partial<Record<number, EstateProblemCode>> = {
    401: "SESSION_INVALID",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "VERSION_CONFLICT",
    422: "VALIDATION_FAILED",
  };
  return codes[status] ?? "UNAVAILABLE";
}
async function readResponse<T>(
  response: Response,
  schema: z.ZodType<T>,
  expectedStatus: number,
): Promise<Result<T, EstateProblem>> {
  if (response.status >= 500) return err({ status: 503, code: "UNAVAILABLE" });
  if (!response.ok) {
    const problem: unknown =
      response.headers.get("content-type")?.split(";")[0]?.trim() ===
      "application/problem+json"
        ? await response.json().catch(() => null)
        : null;
    const parsed = z
      .object({ code: z.string().optional(), field: z.string().optional() })
      .safeParse(problem);
    const known = problemCodeSchema.safeParse(
      parsed.success ? parsed.data.code : undefined,
    );
    const code = known.success ? known.data : fallback(response.status);
    return err({
      status: code === "UNAVAILABLE" ? 503 : response.status,
      code,
      ...(parsed.success && parsed.data.field
        ? { field: parsed.data.field }
        : {}),
    });
  }
  if (response.status !== expectedStatus)
    return err({ status: 503, code: "UNAVAILABLE" });
  const output = schema.safeParse(await response.json());
  return output.success
    ? ok(output.data)
    : err({ status: 503, code: "UNAVAILABLE" });
}
export function createEstateHttpApi(
  baseUrl: string,
  transport: typeof fetch = fetch,
): EstateApi {
  const base = validateBaseUrl(baseUrl);
  async function execute<K extends RouteName>(
    name: K,
    ...args: [
      sessionId: string,
      companyId: string,
      input: Input<K>,
      ids?: string[],
      key?: string,
    ]
  ): Promise<Result<Output<K>, EstateProblem>> {
    const [sessionId, companyId, input, ids = [], key] = args;
    const route = routes[name];
    const parsed = route.input.safeParse(input);
    if (!parsed.success)
      return err({
        status: 422,
        code: "VALIDATION_FAILED",
        field: parsed.error.issues[0]?.path.join("."),
      });
    if (route.method !== "GET" && !keySchema.safeParse(key).success)
      return err({
        status: 422,
        code: "VALIDATION_FAILED",
        field: "idempotencyKey",
      });
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        Authorization: `Session ${sessionId}`,
        "X-Aqarak-Channel": "web_form",
      };
      const url = new URL(
        `${base}/v1/companies/${encodeURIComponent(companyId)}${route.path(ids)}`,
      );
      if (route.method === "GET") {
        for (const [name, value] of Object.entries(parsed.data))
          if (value !== undefined) url.searchParams.set(name, String(value));
      } else {
        headers["Content-Type"] = "application/json";
        headers["Idempotency-Key"] = key ?? "";
      }
      const response = await transport(url.href, {
        method: route.method,
        headers,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        ...(route.method === "GET"
          ? {}
          : { body: JSON.stringify(parsed.data) }),
      });
      return await readResponse(
        response,
        route.output as z.ZodType<Output<K>>,
        route.status,
      );
    } catch {
      return err({ status: 503, code: "UNAVAILABLE" });
    }
  }
  return bindApi(execute);
}
