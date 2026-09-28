import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { z } from "zod";
import { personAccountId } from "../ids";
import { ok, type Result } from "../result";
import { refuse } from "../errors";
import { draftedActionStatus, fieldProvenance, initiator } from "../vocabulary";
import {
  draftedAction,
  draftedActionTransitions,
  transitionDraftedAction,
  type DraftedAction,
  type DraftedActionCommand,
  type DraftedActionContext,
} from "./index";

const account = personAccountId.parse("00000000-0000-4000-8000-000000000003");
const otherAccount = personAccountId.parse(
  "00000000-0000-4000-8000-000000000004",
);
const current: DraftedAction = draftedAction.parse({
  id: "00000000-0000-4000-8000-000000000005",
  company_id: "00000000-0000-4000-8000-000000000001",
  drafted_for_account_id: account,
  status: "ready",
  version: 1,
  payload: {
    amount: 12500,
    deposit: { amount: 5000 },
    units: [{ label: "Unit A" }],
    empty: [],
  },
  field_provenance: {
    "/amount": "ai_confirmed",
    "/deposit/amount": "ai_edited",
    "/units/0/label": "human_entered",
    "/empty": "human_entered",
  },
  base_versions: { contract: 2, schedule: 3 },
  refusal: null,
  reason: null,
});
const context: DraftedActionContext = {
  initiator: "person",
  account_id: account,
  expected_version: 1,
};
const commit: DraftedActionCommand = {
  type: "commit",
  current_versions: { contract: 2, schedule: 3 },
  command_result: ok(undefined),
};
const commandSchema = z.strictObject({
  amount: z.int().positive(),
  deposit: z.strictObject({ amount: z.int().nonnegative() }),
  units: z.array(z.strictObject({ label: z.string().min(1) })),
  empty: z.array(z.never()),
});
const ready: DraftedActionCommand = { type: "ready", schema: commandSchema };
const reject: DraftedActionCommand = {
  type: "reject",
  reason: "Draft is no longer needed",
};

describe("drafted-action lifecycle", () => {
  it("validates the command schema before moving from drafting to ready", () => {
    expect(
      transitionDraftedAction(
        { ...current, status: "drafting" },
        ready,
        context,
      ),
    ).toEqual({ ok: true, value: { ...current, version: 2 } });
    expect(
      transitionDraftedAction(
        {
          ...current,
          status: "drafting",
          payload: { ...current.payload, amount: -1 },
        },
        ready,
        context,
      ),
    ).toEqual({
      ok: false,
      error: { code: "INVALID_INPUT", field: "payload" },
    });
  });
  it("stores validated transformations and requires provenance for schema-added fields", () => {
    const result = transitionDraftedAction(
      {
        ...current,
        status: "drafting",
        payload: { amount: "12500" },
        field_provenance: { "/amount": "human_entered" },
      },
      {
        type: "ready",
        schema: z.object({
          amount: z.coerce.number(),
          currency: z.literal("AED").default("AED"),
        }),
      },
      context,
    );
    expect(result).toMatchObject({
      ok: true,
      value: { payload: { amount: 12500, currency: "AED" } },
    });
    if (!result.ok) throw new Error("Expected a validated draft");
    expect(
      transitionDraftedAction(result.value, commit, {
        ...context,
        expected_version: 2,
      }),
    ).toEqual({
      ok: false,
      error: { code: "INVALID_INPUT", field: "field_provenance" },
    });
  });
  it("refuses schema outputs that cannot be stored as command objects", () => {
    expect(
      transitionDraftedAction(
        { ...current, status: "drafting" },
        {
          type: "ready",
          schema: z.unknown().transform(() => "invalid command"),
        },
        context,
      ),
    ).toEqual({
      ok: false,
      error: { code: "INVALID_INPUT", field: "payload" },
    });
  });
  it("AC-8 commits a validated, attributed command for the drafted-for person", () => {
    expect(transitionDraftedAction(current, commit, context)).toEqual({
      ok: true,
      value: { ...current, status: "committed", version: 2 },
    });
    expect(current.status).toBe("ready");
    expect(current.version).toBe(1);
  });
  it.each([otherAccount, null])(
    "AC-8 refuses commit and rejection by another person: %j",
    (account_id) => {
      for (const command of [commit, reject])
        expect(
          transitionDraftedAction(current, command, { ...context, account_id }),
        ).toEqual({ ok: false, error: { code: "NOT_DRAFTED_FOR_ACTOR" } });
    },
  );
  it.each(["co_worker", "pipeline", "scheduler"] as const)(
    "IN5 and IN7 permit %s to prepare ready rows but never commit or reject",
    (initiator) => {
      expect(
        transitionDraftedAction({ ...current, status: "drafting" }, ready, {
          ...context,
          initiator,
          account_id: null,
        }),
      ).toMatchObject({ ok: true, value: { status: "ready" } });
      for (const command of [commit, reject])
        expect(
          transitionDraftedAction(current, command, { ...context, initiator }),
        ).toEqual({ ok: false, error: { code: "PERSON_REQUIRED" } });
    },
  );
  it.each([
    { contract: 3, schedule: 3 },
    { contract: 2, schedule: 4 },
    { contract: 2 },
    {},
  ])(
    "AC-8 base version drift expires instead of failing: %j",
    (current_versions) => {
      for (const command_result of [ok(undefined), refuse("NOT_PERMITTED")]) {
        expect(
          transitionDraftedAction(
            current,
            { type: "commit", current_versions, command_result },
            context,
          ),
        ).toEqual({
          ok: true,
          value: {
            ...current,
            status: "expired",
            version: 2,
            refusal: { code: "BASE_VERSION_CHANGED" },
          },
        });
      }
    },
  );
  it("ignores additional current versions that the draft did not depend on", () => {
    expect(
      transitionDraftedAction(
        current,
        {
          type: "commit",
          current_versions: { contract: 2, schedule: 3, other: 9 },
          command_result: ok(undefined),
        },
        context,
      ),
    ).toMatchObject({ ok: true, value: { status: "committed" } });
    expect(
      transitionDraftedAction(
        { ...current, base_versions: {} },
        { type: "commit", current_versions: {}, command_result: ok(undefined) },
        context,
      ),
    ).toMatchObject({ ok: true, value: { status: "committed" } });
  });
  it.each(["NOT_PERMITTED", "VERSION_CONFLICT", "REASON_REQUIRED"])(
    "AC-8 other refusal %s becomes failed with its code",
    (code) => {
      expect(
        transitionDraftedAction(
          current,
          {
            type: "commit",
            current_versions: { contract: 2, schedule: 3 },
            command_result: refuse(code, "amount"),
          },
          context,
        ),
      ).toEqual({
        ok: true,
        value: {
          ...current,
          status: "failed",
          version: 2,
          refusal: { code, field: "amount" },
        },
      });
    },
  );
  it("requires a constant-case refusal code when recording failure", () => {
    expect(
      transitionDraftedAction(
        current,
        {
          type: "commit",
          current_versions: { contract: 2, schedule: 3 },
          command_result: refuse("invalid code"),
        },
        context,
      ),
    ).toEqual({
      ok: false,
      error: { code: "INVALID_INPUT", field: "command_result" },
    });
  });
  it.each(["/amount", "/deposit/amount", "/units/0/label", "/empty"])(
    "AC-8 refuses commit when field %s lacks provenance",
    (missing) => {
      const field_provenance = Object.fromEntries(
        Object.entries(current.field_provenance).filter(
          ([path]) => path !== missing,
        ),
      );
      expect(
        transitionDraftedAction(
          { ...current, field_provenance },
          commit,
          context,
        ),
      ).toEqual({
        ok: false,
        error: { code: "INVALID_INPUT", field: "field_provenance" },
      });
    },
  );
  it.each(fieldProvenance.options)(
    "accepts the shared %s provenance vocabulary",
    (provenance) => {
      const field_provenance = Object.fromEntries(
        Object.keys(current.field_provenance).map((path) => [path, provenance]),
      );
      expect(
        transitionDraftedAction(
          { ...current, field_provenance },
          commit,
          context,
        ),
      ).toMatchObject({ ok: true, value: { status: "committed" } });
    },
  );
  it("attributes nulls, booleans, empty objects and escaped JSON Pointer field names", () => {
    const value = draftedAction.parse({
      ...current,
      payload: { "a/b~c": { empty: {}, enabled: true, optional: null } },
      field_provenance: {
        "/a~1b~0c/empty": "human_entered",
        "/a~1b~0c/enabled": "human_entered",
        "/a~1b~0c/optional": "human_entered",
      },
    });
    expect(transitionDraftedAction(value, commit, context)).toMatchObject({
      ok: true,
      value: { status: "committed" },
    });
    expect(
      draftedAction.safeParse({
        ...value,
        field_provenance: { "/a~1b~0c/empty": "unconfirmed" },
      }).success,
    ).toBe(false);
  });
  it.each([undefined, null, "", "   "])(
    "requires a rejection reason: %j",
    (reason) => {
      const command: DraftedActionCommand =
        reason === undefined ? { type: "reject" } : { type: "reject", reason };
      expect(transitionDraftedAction(current, command, context)).toEqual({
        ok: false,
        error: { code: "REASON_REQUIRED", field: "reason" },
      });
    },
  );
  it("records a trimmed rejection reason without changing attribution", () => {
    expect(
      transitionDraftedAction(
        current,
        { type: "reject", reason: "  Duplicate request  " },
        context,
      ),
    ).toEqual({
      ok: true,
      value: {
        ...current,
        status: "rejected",
        reason: "Duplicate request",
        version: 2,
      },
    });
  });
  it.each(
    draftedActionStatus.options.flatMap((status) =>
      [ready, commit, reject].map((command) => ({
        status,
        type: command.type,
        command,
      })),
    ),
  )(
    "$status handles $type according to terminal and preparation rules",
    ({ status, command }) => {
      const allowed =
        (status === "drafting" && command.type === "ready") ||
        (status === "ready" && command.type !== "ready");
      const result = transitionDraftedAction(
        { ...current, status },
        command,
        context,
      );
      expect(result.ok).toBe(allowed);
      if (!allowed)
        expect(result).toEqual({
          ok: false,
          error: { code: "INVALID_TRANSITION" },
        });
    },
  );
  it("exports every allowed transition as data and refuses stale row versions", () => {
    expect(draftedActionTransitions).toEqual({
      drafting: { ready: ["ready"] },
      ready: {
        commit: ["committed", "expired", "failed"],
        reject: ["rejected"],
      },
      committed: {},
      rejected: {},
      expired: {},
      failed: {},
    });
    expect(
      transitionDraftedAction(current, commit, {
        ...context,
        expected_version: 0,
      }),
    ).toEqual({ ok: false, error: { code: "VERSION_CONFLICT" } });
  });
  it("property: only the person can commit, and every base drift expires", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...initiator.options),
        fc.constantFrom(account, otherAccount),
        fc.nat({ max: 100 }),
        fc.boolean(),
        (initiator, account_id, version, refused) => {
          const command_result: Result<unknown> = refused
            ? refuse("NOT_PERMITTED")
            : ok(undefined);
          const result = transitionDraftedAction(
            current,
            {
              type: "commit",
              current_versions: { contract: version, schedule: 3 },
              command_result,
            },
            { ...context, initiator, account_id },
          );
          if (initiator !== "person")
            expect(result).toMatchObject({
              ok: false,
              error: { code: "PERSON_REQUIRED" },
            });
          else if (account_id !== account)
            expect(result).toMatchObject({
              ok: false,
              error: { code: "NOT_DRAFTED_FOR_ACTOR" },
            });
          else
            expect(result).toMatchObject({
              ok: true,
              value: {
                status:
                  version !== 2 ? "expired" : refused ? "failed" : "committed",
              },
            });
        },
      ),
      { seed: 5208, numRuns: 100 },
    );
  }, 60_000);
});
