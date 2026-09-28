import { describe, expect, it } from "vitest";
import { ownerStatementId } from "../ids";
import { fils } from "../money";
import { localDate } from "../time";
import {
  ownerStatementTransitions,
  transitionOwnerStatement,
  type StatementDecision,
} from "./index";
import { context, otherCompany, uuid, value } from "./test-support";

function statement(): StatementDecision {
  return {
    statement: {
      id: ownerStatementId.parse(uuid(1)),
      company_id: context.company_id,
      status: "draft",
      period_from: localDate.parse("2026-09-01"),
      period_to: context.on,
      opening_fils: fils.parse(1000),
      collections_fils: fils.parse(10000),
      fees_fils: fils.parse(500),
      expenses_fils: fils.parse(2000),
      payouts_fils: fils.parse(3000),
      closing_fils: fils.parse(5500),
      period_locked: false,
      number: null,
    },
    counter: { company_id: context.company_id, series: "STMT", next: 1 },
  };
}
function reviewed(): StatementDecision {
  return value(
    transitionOwnerStatement(statement(), { to: "in_review" }, context),
  );
}

describe("owner statement reconciliation", () => {
  it("AC-10 refuses an unbalanced statement without consuming a number or locking the period", () => {
    const state = reviewed();
    const unbalanced = {
      ...state,
      statement: { ...state.statement, closing_fils: fils.parse(5501) },
    };
    const before = JSON.stringify(unbalanced);
    expect(
      transitionOwnerStatement(unbalanced, { to: "issued" }, context),
    ).toMatchObject({ ok: false, error: { code: "STATEMENT_NOT_BALANCED" } });
    expect(JSON.stringify(unbalanced)).toBe(before);
  });
  it("AC-10 a balanced reviewed statement issues, consumes STMT and locks its period", () => {
    const state = reviewed();
    const next = value(
      transitionOwnerStatement(state, { to: "issued" }, context),
    );
    expect(next.statement).toMatchObject({
      status: "issued",
      number: "STMT-000001",
      period_locked: true,
    });
    expect(next.counter.next).toBe(2);
    expect(state.statement.period_locked).toBe(false);
    const superseded = value(
      transitionOwnerStatement(next, { to: "superseded" }, context),
    );
    expect(superseded.statement.period_locked).toBe(true);
    expect(superseded.counter).toEqual(next.counter);
  });
  it("returns for revision only with a reason", () => {
    const state = reviewed();
    expect(
      transitionOwnerStatement(state, { to: "draft" }, context),
    ).toMatchObject({ ok: false, error: { code: "REASON_REQUIRED" } });
    expect(
      value(
        transitionOwnerStatement(
          state,
          { to: "draft", reason: " Correct expense " },
          context,
        ),
      ).statement,
    ).toMatchObject({ status: "draft", return_reason: "Correct expense" });
  });
  it.each(["draft", "in_review", "issued", "superseded"] as const)(
    "refuses transition from superseded to %s",
    (to) => {
      const state = statement();
      expect(
        transitionOwnerStatement(
          { ...state, statement: { ...state.statement, status: "superseded" } },
          { to },
          context,
        ),
      ).toMatchObject({ ok: false, error: { code: "INVALID_TRANSITION" } });
    },
  );
  it("requires valid period, nonnegative flows, matching counter and authorized actor", () => {
    const state = reviewed();
    for (const item of [
      { ...state.statement, period_from: localDate.parse("2026-10-01") },
      { ...state.statement, fees_fils: fils.parse(-1) },
    ])
      expect(
        transitionOwnerStatement(
          { ...state, statement: item },
          { to: "issued" },
          context,
        ).ok,
      ).toBe(false);
    expect(
      transitionOwnerStatement(
        { ...state, counter: { ...state.counter, series: "INV" } },
        { to: "issued" },
        context,
      ).ok,
    ).toBe(false);
    expect(
      transitionOwnerStatement(
        state,
        { to: "issued" },
        { ...context, company_id: otherCompany },
      ).ok,
    ).toBe(false);
    expect(ownerStatementTransitions.in_review).toEqual(["draft", "issued"]);
  });
  it("allows negative balances when exact signed reconciliation holds", () => {
    const state = reviewed();
    expect(
      transitionOwnerStatement(
        {
          ...state,
          statement: {
            ...state.statement,
            opening_fils: fils.parse(-9000),
            closing_fils: fils.parse(-4500),
          },
        },
        { to: "issued" },
        context,
      ).ok,
    ).toBe(true);
  });
});
