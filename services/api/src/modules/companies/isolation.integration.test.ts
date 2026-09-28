import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { companyRoutes } from "./index";
import type { RouteDefinition } from "./routes";
import {
  assertChain,
  events,
  expectDenial,
  harness,
  invite,
  memberId,
  securityTypes,
} from "../identity/integration-support";
function routeBody(route: RouteDefinition): unknown {
  if (route.method === "GET") return undefined;
  if (route.method === "PATCH") return { expectedVersion: 1, trn: "TEST" };
  if (route.path.endsWith("/invitations"))
    return {
      kind: "staff",
      email: "other@example.com",
      locale: "en",
      staffRoles: ["manager"],
    };
  return {
    expectedVersion: 1,
    reason: "Synthetic reason",
    staffRoles: ["manager"],
  };
}
it("I-10 covers the entire route registry with foreign-company and foreign-record refusals", async () => {
  const h = harness();
  const a = await h.account();
  const companyA = await h.company(a);
  const b = await h.account();
  const companyB = await h.company(b);
  const invitee = await h.account();
  const invitation = await invite(h, companyB, b, { invitee: invitee });
  const memberB = await memberId(h, companyB, b, b);
  let covered = 0;
  for (const route of companyRoutes) {
    const path = `/v1/companies${route.path.replace(":companyId", companyB).replace(":membershipId", memberB).replace(":invitationId", invitation.invitation.id)}`;
    await expectDenial(h, companyB, b, {
      run: () =>
        h.request(route.method, path, { account: a, body: routeBody(route) }),
      code: "NOT_FOUND",
      status: 404,
    });
    covered++;
    if (route.idParam) {
      const beforeB = await events(h, companyB, b);
      await expectDenial(h, companyA, a, {
        run: () =>
          h.request(route.method, path.replace(companyB, companyA), {
            account: a,
            body: routeBody(route),
          }),
        code: "NOT_FOUND",
        status: 404,
      });
      expect(await events(h, companyB, b)).toEqual(beforeB);
    }
  }
  expect(covered).toBe(companyRoutes.length);
  expect(companyRoutes).toHaveLength(11);
  await assertChain(h, companyA, a);
  await assertChain(h, companyB, b);
}, 900_000);
it("treats malformed or absent companies as missing and writes account security only for an absent UUID", async () => {
  const h = harness();
  const account = await h.account();
  expect(
    (await h.request("GET", "/v1/companies/not-a-uuid", { account })).status,
  ).toBe(404);
  expect(
    (await h.request("GET", `/v1/companies/${randomUUID()}`, { account }))
      .status,
  ).toBe(404);
  expect(
    (await securityTypes(h, account)).filter(
      (type) => type === "access_refused",
    ),
  ).toHaveLength(1);
});
