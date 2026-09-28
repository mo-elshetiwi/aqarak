import { afterEach, describe, expect, it } from "vitest";
import {
  createRetroactiveFixture,
  createDraft,
  uploadDraft,
  confirmation,
  assertDenial,
} from "./retroactive-test-support";
import type { Fixture } from "./test-support/fixture";
import { randomUUID } from "node:crypto";
const integration =
  process.env.AQARAK_INTEGRATION === "1" ? describe : describe.skip;
let active: Fixture | undefined;
afterEach(() => {
  active?.deps.s3.destroy();
  active = undefined;
});
integration("Retroactive source binding", { timeout: 240000 }, () => {
  it("binds confirmation to the intake source and refuses an explicitly different source", async () => {
    const f = await createRetroactiveFixture();
    active = f;
    const draft = await uploadDraft(f, await createDraft(f));
    const body = confirmation(f, draft),
      route = `/retroactive/${draft.draftId}/confirm`;
    await assertDenial(
      f,
      () => f.request(route, { ...body, documentVersionId: randomUUID() }),
      {
        status: 409,
        domainCode: "RETROACTIVE_EVIDENCE_MISSING",
        field: "registered_document",
      },
    );
    const { documentVersionId, ...withoutDocumentId } = body;
    const response = await f.request(route, withoutDocumentId);
    expect(response.status, await response.clone().text()).toBe(201);
    expect(await response.json()).toMatchObject({
      document: { documentVersionId, reviewStatus: "accepted" },
      scheduleActivation: "deferred_to_payments",
    });
  });
});
