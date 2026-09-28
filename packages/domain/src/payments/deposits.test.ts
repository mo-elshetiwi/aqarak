import { describe, expect, it } from "vitest";
import { depositId } from "../ids";
import { fils } from "../money";
import {
  depositTransitions,
  transitionDeposit,
  type Deposit,
  type DepositCommand,
} from "./index";
import {
  context,
  documentVersion,
  otherCompany,
  uuid,
  value,
} from "./test-support";

function deposit(): Deposit {
  return {
    id: depositId.parse(uuid(1)),
    company_id: context.company_id,
    status: "expected",
    amount_fils: fils.parse(10000),
    held_fils: fils.parse(0),
    inspection_document_version_id: null,
    deductions: [],
    refund_fils: fils.parse(0),
    applied_fils: fils.parse(0),
    top_up_fils: fils.parse(0),
  };
}
function held(): Deposit {
  return value(transitionDeposit(deposit(), { to: "held" }, context));
}
function due(): Deposit {
  return value(
    transitionDeposit(
      held(),
      { to: "refund_due", inspection_document_version_id: documentVersion },
      context,
    ),
  );
}

describe("deposit recording", () => {
  it("AC-10 itemised deductions cannot exceed held funds", () => {
    const state = due();
    const before = JSON.stringify(state);
    expect(
      transitionDeposit(
        state,
        {
          to: "refunded",
          deductions: [{ amount_fils: fils.parse(10001), reason: "Repair" }],
        },
        context,
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "DEDUCTIONS_EXCEED_DEPOSIT" },
    });
    expect(JSON.stringify(state)).toBe(before);
    const next = value(
      transitionDeposit(
        state,
        {
          to: "refunded",
          deductions: [
            { amount_fils: fils.parse(2000), reason: " Repair " },
            { amount_fils: fils.parse(3000), reason: "Cleaning" },
          ],
        },
        context,
      ),
    );
    expect(next.refund_fils).toBe(5000);
    expect(next.deductions[0]?.reason).toBe("Repair");
    expect(next.status).toBe("refunded");
    expect(next.inspection_document_version_id).toBe(documentVersion);
  });
  it.each([
    [12000, 2000],
    [10000, 0],
    [8000, 0],
  ])("AC-10 carried over deposit %s requires top-up %s", (amount, topUp) => {
    const next = value(
      transitionDeposit(
        held(),
        { to: "carried_over", new_deposit_fils: fils.parse(amount) },
        context,
      ),
    );
    expect(next.top_up_fils).toBe(topUp);
    expect(next.held_fils).toBe(10000);
  });
  it("applies held funds only where sufficient unpaid dues exist", () => {
    expect(
      value(
        transitionDeposit(
          held(),
          { to: "applied", unpaid_dues_fils: fils.parse(12000) },
          context,
        ),
      ),
    ).toMatchObject({ status: "applied", applied_fils: 10000 });
    for (const amount of [0, -1, 9999])
      expect(
        transitionDeposit(
          held(),
          { to: "applied", unpaid_dues_fils: fils.parse(amount) },
          context,
        ).ok,
      ).toBe(false);
  });
  it.each(
    [[], [{ amount_fils: fils.parse(10000), reason: "Repair" }]].map(
      (deductions) => ({ deductions }),
    ),
  )("allows no deduction or full held deduction", ({ deductions }) => {
    expect(
      value(transitionDeposit(due(), { to: "refunded", deductions }, context))
        .refund_fils,
    ).toBe(deductions.length === 0 ? 10000 : 0);
  });
  it("requires a reason and positive amount for each deduction", () => {
    expect(
      transitionDeposit(
        due(),
        {
          to: "refunded",
          deductions: [{ amount_fils: fils.parse(1), reason: " " }],
        },
        context,
      ),
    ).toMatchObject({ ok: false, error: { code: "REASON_REQUIRED" } });
    expect(
      transitionDeposit(
        due(),
        {
          to: "refunded",
          deductions: [{ amount_fils: fils.parse(0), reason: "Repair" }],
        },
        context,
      ).ok,
    ).toBe(false);
    expect(
      transitionDeposit(
        held(),
        { to: "carried_over", new_deposit_fils: fils.parse(-1) },
        context,
      ).ok,
    ).toBe(false);
    expect(
      transitionDeposit(
        { ...deposit(), amount_fils: fils.parse(0) },
        { to: "held" },
        context,
      ).ok,
    ).toBe(false);
  });
  it.each<DepositCommand>([
    { to: "held" },
    { to: "refund_due", inspection_document_version_id: documentVersion },
    { to: "refunded", deductions: [] },
    { to: "applied", unpaid_dues_fils: fils.parse(10000) },
    { to: "carried_over", new_deposit_fils: fils.parse(10000) },
  ])("refuses every transition from a terminal state: $to", (command) => {
    expect(
      transitionDeposit({ ...held(), status: "refunded" }, command, context),
    ).toMatchObject({ ok: false, error: { code: "INVALID_TRANSITION" } });
  });
  it("uses lifecycle data and enforces company actor boundaries", () => {
    expect(depositTransitions.held).toEqual([
      "refund_due",
      "applied",
      "carried_over",
    ]);
    expect(
      transitionDeposit(
        deposit(),
        { to: "held" },
        { ...context, company_id: otherCompany },
      ).ok,
    ).toBe(false);
    expect(
      transitionDeposit(
        deposit(),
        { to: "held" },
        { ...context, role: "tenant" },
      ).ok,
    ).toBe(false);
  });
});
