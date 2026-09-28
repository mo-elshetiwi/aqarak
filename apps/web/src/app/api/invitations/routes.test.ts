import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
import { createMockApi, createMockState } from "@/lib/api/mock-adapter";
import { MOCK_COMPANY_A_ID, MOCK_ONLY_PASSWORD } from "@/lib/api/mock-fixtures";
import { SESSION_COOKIE } from "@/lib/session/cookie";
import { csrfTokenFor } from "@/lib/session/csrf";
import type { AqarakApi } from "@/lib/api/contract";
import { POST as create } from "../companies/[companyId]/invitations/route";
import { POST as preview } from "./preview/route";
import { POST as accept } from "./accept/route";
const { getApi } = vi.hoisted(() => ({ getApi: vi.fn<() => AqarakApi>() }));
vi.mock("@/lib/api", () => ({ getApi }));
const origin = "http://127.0.0.1:3100";
const company = { params: Promise.resolve({ companyId: MOCK_COMPANY_A_ID }) };
let api: AqarakApi;
let session: string;
function request(body: unknown, authenticated = false): NextRequest {
  return new NextRequest(`${origin}/api/invitations`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(authenticated
        ? {
            Cookie: `${SESSION_COOKIE}=${session}`,
            "X-CSRF-Token": csrfTokenFor(session),
          }
        : {}),
    },
    body: JSON.stringify(body),
  });
}
beforeEach(async () => {
  vi.stubEnv("AQARAK_APP_ORIGIN", origin);
  vi.stubEnv("NODE_ENV", "test");
  api = createMockApi({ state: createMockState() });
  getApi.mockReset().mockReturnValue(api);
  const signedIn = await api.signIn({
    email: "hassan.ali@example.com",
    password: MOCK_ONLY_PASSWORD,
    client: "web",
  });
  if (!signedIn.ok) throw new Error(signedIn.error.code);
  session = signedIn.value.session.id;
});
it("returns only the declared invitation fields and the one-time same-origin link", async () => {
  const input = {
    locale: "en",
    email: "member@example.com",
    staffRoles: ["manager"],
    inviteLocale: "ar",
    idempotencyKey: randomUUID(),
  };
  const response = await create(request(input, true), company);
  const data = (await response.json()) as {
    inviteUrl: string;
    invitation: Record<string, unknown>;
  };
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(Object.keys(data).sort()).toEqual(["invitation", "inviteUrl"]);
  expect(Object.keys(data.invitation).sort()).toEqual([
    "deliveryStatus",
    "email",
    "expiresAt",
    "id",
    "staffRoles",
    "status",
  ]);
  const link = new URL(data.inviteUrl);
  expect(link.origin).toBe(origin);
  expect(link.pathname).toBe("/ar/invitation");
  expect(link.search).toBe("");
  const token = link.hash.slice(1);
  const shown = await preview(request({ token }));
  expect(await shown.json()).toMatchObject({
    invitation: { maskedEmail: "m***@example.com", status: "pending" },
  });
  expect(
    await (await create(request(input, true), company)).json(),
  ).toMatchObject({ inviteUrl: null });
  expect(
    await (
      await accept(
        request({ locale: "en", token, idempotencyKey: randomUUID() }, true),
      )
    ).json(),
  ).toMatchObject({ code: "INVITATION_EMAIL_MISMATCH" });
});
it("checks origin, session, CSRF and input before accessing the API", async () => {
  getApi.mockClear();
  for (const route of [
    preview,
    accept,
    (req: NextRequest) => create(req, company),
  ]) {
    const req = request({});
    req.headers.set("origin", "https://foreign.example");
    expect((await route(req)).status).toBe(403);
  }
  expect((await accept(request({}))).status).toBe(401);
  const noCsrf = request({}, true);
  noCsrf.headers.delete("x-csrf-token");
  expect((await create(noCsrf, company)).status).toBe(403);
  expect((await preview(request({ token: "invalid" }))).status).toBe(400);
  expect(
    (await create(request({ staffRoles: [] }, true), company)).status,
  ).toBe(400);
  expect(getApi).not.toHaveBeenCalled();
});
