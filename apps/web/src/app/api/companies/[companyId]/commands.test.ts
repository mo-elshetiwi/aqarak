import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";
import { createMockApi, createMockState } from "@/lib/api/mock-adapter";
import { SESSION_COOKIE } from "@/lib/session/cookie";
import { csrfTokenFor } from "@/lib/session/csrf";
import { POST as roles } from "./members/[membershipId]/roles/route";
import { POST as suspend } from "./members/[membershipId]/suspend/route";
import { POST as reactivate } from "./members/[membershipId]/reactivate/route";
import { POST as remove } from "./members/[membershipId]/remove/route";
import { POST as revoke } from "./invitations/[invitationId]/revoke/route";
import { POST as resend } from "./invitations/[invitationId]/resend/route";
import { POST as settings } from "./route";
const { getApi } = vi.hoisted(() => ({ getApi: vi.fn() }));
vi.mock("@/lib/api", () => ({ getApi }));
it("guards every new command with origin, session, CSRF, validation and no-store", async () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("AQARAK_APP_ORIGIN", "http://localhost:3100");
  getApi.mockReturnValue(createMockApi({ state: createMockState() }));
  const session = "a".repeat(43);
  const params = {
    params: Promise.resolve({
      companyId: randomUUID(),
      membershipId: randomUUID(),
      invitationId: randomUUID(),
    }),
  };
  for (const route of [
    roles,
    suspend,
    reactivate,
    remove,
    revoke,
    resend,
    settings,
  ]) {
    for (const [mode, status, code] of [
      ["origin", 403, "FORBIDDEN_ORIGIN"],
      ["session", 401, "SESSION_INVALID"],
      ["csrf", 403, "CSRF_TOKEN_INVALID"],
      ["body", 400, "VALIDATION_FAILED"],
    ] as const) {
      const headers = {
        Origin:
          mode === "origin"
            ? "https://foreign.example"
            : "http://localhost:3100",
        ...(mode === "session"
          ? {}
          : { Cookie: `${SESSION_COOKIE}=${session}` }),
        ...(mode === "csrf" ? {} : { "X-CSRF-Token": csrfTokenFor(session) }),
      };
      const response = await route(
        new NextRequest("http://localhost:3100/api/companies", {
          method: "POST",
          headers,
          body: "{}",
        }),
        params,
      );
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ code });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  }
  expect(getApi).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
});
