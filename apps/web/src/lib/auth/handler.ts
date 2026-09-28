import { NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";
import { getApi } from "../api";
import {
  sessionIdSchema,
  type AqarakApi,
  type ApiProblemCode,
} from "../api/contract";
import { SESSION_COOKIE, SIGN_UP_COOKIE } from "../session/cookie";
import { verifyCsrfToken } from "../session/csrf";
import { checkRequestOrigin } from "../session/origin";
import type { AuthContext, AuthResult, CookieChange } from "./actions";

type HandlerProblemCode =
  ApiProblemCode | "FORBIDDEN_ORIGIN" | "CSRF_TOKEN_INVALID";
function problem(status: number, code: HandlerProblemCode): NextResponse {
  return NextResponse.json(
    { type: "about:blank", title: code, status, code },
    {
      status,
      headers: {
        "Content-Type": "application/problem+json",
        "Cache-Control": "no-store",
      },
    },
  );
}
function setCookies(
  response: NextResponse,
  changes: CookieChange[] = [],
): NextResponse {
  for (const cookie of changes)
    response.cookies.set(cookie.name, cookie.value, cookie.options);
  response.headers.delete("x-middleware-set-cookie");
  return response;
}
interface HandlerOptions<T, Data extends object> {
  schema: z.ZodType<T>;
  authenticated?: boolean;
  run: (
    api: AqarakApi,
    input: T,
    context: AuthContext,
  ) => Promise<AuthResult<Data>>;
}
/** Applies the shared request boundary before invoking an authentication operation. */
export function authHandler<T, Data extends object = never>(
  options: HandlerOptions<T, Data>,
): (request: NextRequest) => Promise<NextResponse> {
  return async (request) => {
    try {
      if (!checkRequestOrigin(request)) return problem(403, "FORBIDDEN_ORIGIN");
      const sessionId = request.cookies.get(SESSION_COOKIE)?.value ?? "";
      if (options.authenticated) {
        if (!sessionIdSchema.safeParse(sessionId).success)
          return problem(401, "SESSION_INVALID");
        if (!verifyCsrfToken(sessionId, request.headers.get("x-csrf-token")))
          return problem(403, "CSRF_TOKEN_INVALID");
      }
      const parsed = options.schema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success) return problem(400, "VALIDATION_FAILED");
      const result = await options.run(getApi(), parsed.data, {
        sessionId,
        origin: request.headers.get("origin") ?? new URL(request.url).origin,
        pendingEmail: request.cookies.get(SIGN_UP_COOKIE)?.value,
      });
      if (!result.ok)
        return setCookies(
          problem(result.error.status, result.error.code),
          result.error.cookies,
        );
      return setCookies(
        NextResponse.json(result.value.body, {
          headers: { "Cache-Control": "no-store" },
        }),
        result.value.cookies,
      );
    } catch {
      return problem(503, "UNAVAILABLE");
    }
  };
}
