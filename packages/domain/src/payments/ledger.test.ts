import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  chargeId,
  contractId,
  instalmentId,
  paymentId,
  receiptId,
} from "../ids";
import { fils } from "../money";
import { localDate } from "../time";
import {
  allocate,
  allocateOldestFirst,
  closeInstalment,
  deriveInstalmentStatus,
  deriveChargeStatus,
  paymentCredit,
  paymentsErrorCode,
  recordPayment,
  recordRefund,
  reversePayment,
  targetAllocated,
  voidAllocation,
  type MoneyLedger,
  type MoneyResult,
  type OpenTarget,
} from "./index";
import {
  allocation,
  context,
  ledger,
  otherCompany,
  payment,
  receipt,
  uuid,
  value,
} from "./test-support";

function code(result: MoneyResult<unknown>, expected: string): void {
  expect(result).toMatchObject({ ok: false, error: { code: expected } });
}
function invariants(state: MoneyLedger): void {
  for (const p of state.payments) {
    const allocated = state.allocations
      .filter((a) => a.payment_id === p.id && a.status === "active")
      .reduce((sum, a) => sum + a.amount_fils, 0);
    const refunds = state.refunds
      .filter((r) => r.payment_id === p.id)
      .reduce((sum, r) => sum + r.amount_fils, 0);
    expect(allocated + refunds).toBeLessThanOrEqual(p.amount_fils);
    expect(paymentCredit(p, state.allocations, state.refunds)).toBe(
      p.status === "recorded" ? p.amount_fils - allocated - refunds : 0,
    );
  }
  for (const target of state.instalments) {
    const allocated = state.allocations
      .filter(
        (a) =>
          a.instalment_id === target.id &&
          a.status === "active" &&
          state.payments.some(
            (p) => p.id === a.payment_id && p.status === "recorded",
          ),
      )
      .reduce((sum, a) => sum + a.amount_fils, 0);
    const total = target.amount_fils + target.vat_fils;
    expect(allocated).toBeLessThanOrEqual(total);
    expect(target.status).toBe(
      allocated === 0 ? "open" : allocated === total ? "paid" : "partly_paid",
    );
  }
}

describe("allocation conservation", () => {
  it.each([
    [100, "paid"],
    [99, "partly_paid"],
  ])("AC-4 derives coverage for %s fils", (amount, status) => {
    const state = ledger();
    const before = JSON.stringify(state);
    const next = value(allocate(state, allocation(1, amount), context));
    expect(next.instalments[0]?.status).toBe(status);
    expect(JSON.stringify(state)).toBe(before);
  });
  it("AC-4 refuses one fils above remaining payment credit", () => {
    const state = value(allocate(ledger(), allocation(1, 20), context));
    code(
      allocate(state, allocation(2, 81), context),
      "ALLOCATION_EXCEEDS_PAYMENT",
    );
  });
  it("AC-4 refuses one fils above remaining target balance", () => {
    const state = { ...ledger(), payments: [payment(1, 200)] };
    code(
      allocate(state, allocation(1, 101), context),
      "ALLOCATION_EXCEEDS_BALANCE",
    );
  });
  it.each([0, -1])("refuses nonpositive allocation %s", (amount) => {
    code(allocate(ledger(), allocation(1, amount), context), "INVALID_INPUT");
  });
  it("refuses both or neither allocation target", () => {
    code(
      allocate(ledger(), { ...allocation(), instalment_id: null }, context),
      "INVALID_INPUT",
    );
    code(
      allocate(
        ledger(),
        { ...allocation(), charge_id: chargeId.parse(uuid(1)) },
        context,
      ),
      "INVALID_INPUT",
    );
  });
  it("allocates and restores charges including VAT", () => {
    const state = ledger();
    const next = value(
      allocate(
        state,
        {
          ...allocation(),
          instalment_id: null,
          charge_id: chargeId.parse(uuid(1)),
        },
        context,
      ),
    );
    expect(next.charges[0]?.status).toBe("open");
    expect(
      value(voidAllocation(next, { allocation_id: allocation().id }, context))
        .charges[0]?.status,
    ).toBe("open");
  });
  it.each(["waived", "cancelled"] as const)(
    "preserves explicit %s status and refuses allocation",
    (status) => {
      const state = ledger();
      const instalments = state.instalments.map((i) => ({ ...i, status }));
      code(
        allocate({ ...state, instalments }, allocation(), context),
        "INVALID_TRANSITION",
      );
      for (const target of instalments)
        expect(deriveInstalmentStatus(target, fils.parse(0))).toBe(status);
    },
  );
  it("refuses unknown, duplicate and foreign-contract records", () => {
    code(
      allocate({ ...ledger(), payments: [] }, allocation(), context),
      "INVALID_INPUT",
    );
    code(
      allocate({ ...ledger(), instalments: [] }, allocation(), context),
      "INVALID_INPUT",
    );
    code(
      allocate(
        {
          ...ledger(),
          payments: [{ ...payment(), contract_id: contractId.parse(uuid(2)) }],
        },
        allocation(),
        context,
      ),
      "INVALID_INPUT",
    );
    const state = value(allocate(ledger(), allocation(1, 1), context));
    code(allocate(state, allocation(1, 1), context), "INVALID_INPUT");
    code(
      voidAllocation(ledger(), { allocation_id: allocation().id }, context),
      "INVALID_INPUT",
    );
    const voided = value(
      voidAllocation(state, { allocation_id: allocation().id }, context),
    );
    code(
      voidAllocation(voided, { allocation_id: allocation().id }, context),
      "INVALID_TRANSITION",
    );
  });
  it("ignores allocations from reversed payments and unrelated or voided allocations", () => {
    const state = {
      ...ledger(),
      payments: [{ ...payment(), status: "reversed" as const }],
      allocations: [
        {
          ...allocation(),
          instalment_id: instalmentId.parse(uuid(1)),
          charge_id: null,
          status: "active" as const,
        },
      ],
    };
    expect(
      targetAllocated(
        { instalment_id: instalmentId.parse(uuid(1)), charge_id: null },
        state,
      ),
    ).toBe(0);
  });
  it("voiding part of a paid instalment recomputes partly paid", () => {
    const state = value(
      allocate(
        value(allocate(ledger(), allocation(1, 40), context)),
        allocation(2, 60),
        context,
      ),
    );
    expect(
      value(voidAllocation(state, { allocation_id: allocation(1).id }, context))
        .instalments[0]?.status,
    ).toBe("partly_paid");
  });
});

describe("refund and reversal", () => {
  it("AC-4 refunds only remaining credit and requires a reason", () => {
    const state = value(allocate(ledger(), allocation(1, 60), context));
    code(
      recordRefund(
        state,
        {
          payment_id: payment().id,
          amount_fils: fils.parse(41),
          reason: "Return excess",
        },
        context,
      ),
      "REFUND_EXCEEDS_CREDIT",
    );
    code(
      recordRefund(
        state,
        { payment_id: payment().id, amount_fils: fils.parse(40), reason: " " },
        context,
      ),
      "REASON_REQUIRED",
    );
    const next = value(
      recordRefund(
        state,
        {
          payment_id: payment().id,
          amount_fils: fils.parse(40),
          reason: " Return excess ",
        },
        context,
      ),
    );
    expect(paymentCredit(payment(), next.allocations, next.refunds)).toBe(0);
    expect(next.refunds[0]?.reason).toBe("Return excess");
    code(
      reversePayment(
        next,
        {
          payment_id: payment().id,
          reason_code: "recorded_in_error",
          reason: "Correction",
        },
        context,
      ),
      "PAYMENT_HAS_REFUNDS",
    );
  });
  it.each([0, -1])("refuses invalid refund %s", (amount) => {
    code(
      recordRefund(
        ledger(),
        {
          payment_id: payment().id,
          amount_fils: fils.parse(amount),
          reason: "Return excess",
        },
        context,
      ),
      "INVALID_INPUT",
    );
  });
  it("reverses fully, preserves consumed receipt numbers and refuses repeated reversal", () => {
    const state = value(allocate(ledger(), allocation(), context));
    const command = {
      payment_id: payment().id,
      reason_code: "recorded_in_error" as const,
      reason: " Correction ",
    };
    const next = value(reversePayment(state, command, context));
    expect(next.payments[0]?.status).toBe("reversed");
    expect(next.allocations[0]?.status).toBe("voided");
    expect(next.instalments[0]?.status).toBe("open");
    expect(next.receipts[0]).toMatchObject({
      status: "voided",
      number: "RCPT-000001",
      void_reason: "Correction",
    });
    expect(next.reversals[0]?.amount_fils).toBe(100);
    expect(next.counters).toEqual(state.counters);
    code(reversePayment(next, command, context), "PAYMENT_ALREADY_REVERSED");
    code(allocate(next, allocation(2, 1), context), "PAYMENT_REVERSED");
    code(
      recordRefund(
        next,
        {
          payment_id: payment().id,
          amount_fils: fils.parse(1),
          reason: "Return",
        },
        context,
      ),
      "PAYMENT_REVERSED",
    );
  });
  it("checks absent payments, explanation and prior reversal records", () => {
    const command = {
      payment_id: payment().id,
      reason_code: "bounced" as const,
      reason: "Return",
    };
    code(
      reversePayment({ ...ledger(), payments: [] }, command, context),
      "INVALID_INPUT",
    );
    code(
      recordRefund(
        { ...ledger(), payments: [] },
        {
          payment_id: payment().id,
          amount_fils: fils.parse(1),
          reason: "Return",
        },
        context,
      ),
      "INVALID_INPUT",
    );
    code(
      reversePayment(ledger(), { ...command, reason: "" }, context),
      "REASON_REQUIRED",
    );
    code(
      reversePayment(
        {
          ...ledger(),
          reversals: [{ ...command, amount_fils: fils.parse(100) }],
        },
        command,
        context,
      ),
      "PAYMENT_ALREADY_REVERSED",
    );
  });
  it("leaves unrelated payments, receipts and voided allocations intact", () => {
    const base = value(allocate(ledger(), allocation(1, 50), context));
    const voided = value(
      voidAllocation(base, { allocation_id: allocation().id }, context),
    );
    const state = {
      ...voided,
      payments: [payment(), payment(2)],
      receipts: [receipt(), { ...receipt(2), status: "voided" as const }],
    };
    const next = value(
      reversePayment(
        state,
        { payment_id: payment().id, reason_code: "bounced", reason: "Return" },
        context,
      ),
    );
    expect(next.payments[1]).toEqual(payment(2));
    expect(next.receipts[1]).toEqual(state.receipts[1]);
    expect(next.allocations).toEqual(state.allocations);
  });
});

describe("explicit instalment closure and planning", () => {
  it.each(["waived", "cancelled"] as const)(
    "closes an open instalment as %s only with a reason",
    (status) => {
      const command = {
        instalment_id: instalmentId.parse(uuid(1)),
        status,
        reason: "Agreement",
      };
      expect(
        value(closeInstalment(ledger(), command, context)).instalments[0]
          ?.status,
      ).toBe(status);
      code(
        closeInstalment(ledger(), { ...command, reason: "" }, context),
        "REASON_REQUIRED",
      );
      code(
        closeInstalment({ ...ledger(), instalments: [] }, command, context),
        "INVALID_INPUT",
      );
      const allocated = value(allocate(ledger(), allocation(), context));
      code(closeInstalment(allocated, command, context), "INVALID_TRANSITION");
      code(
        closeInstalment(
          { ...allocated, instalments: ledger().instalments },
          command,
          context,
        ),
        "INVALID_TRANSITION",
      );
    },
  );
  it("plans oldest first, then sequence, preserving input and remainder credit", () => {
    const targets: readonly OpenTarget[] = [
      {
        instalment_id: instalmentId.parse(uuid(3)),
        charge_id: null,
        due_on: context.on,
        seq_no: 2,
        balance_fils: fils.parse(30),
        contract_id: payment().contract_id,
      },
      {
        instalment_id: null,
        charge_id: chargeId.parse(uuid(1)),
        due_on: localDate.parse("2026-01-01"),
        seq_no: 9,
        balance_fils: fils.parse(40),
        contract_id: payment().contract_id,
      },
      {
        instalment_id: instalmentId.parse(uuid(2)),
        charge_id: null,
        due_on: context.on,
        seq_no: 1,
        balance_fils: fils.parse(40),
        contract_id: payment().contract_id,
      },
    ];
    const plan = value(allocateOldestFirst(payment(), targets));
    expect(plan.allocations.map((a) => a.amount_fils)).toEqual([40, 40, 20]);
    expect(plan.credit_fils).toBe(0);
    expect(
      value(allocateOldestFirst(payment(1, 200), targets)).credit_fils,
    ).toBe(90);
    expect(
      value(allocateOldestFirst(payment(1, 10), targets)).allocations,
    ).toHaveLength(1);
    expect(targets[0]?.seq_no).toBe(2);
    const allocated = value(allocate(ledger(), allocation(1, 95), context));
    expect(
      value(allocateOldestFirst(payment(), targets, allocated.allocations, []))
        .allocations[0]?.amount_fils,
    ).toBe(5);
    code(
      allocateOldestFirst({ ...payment(), status: "reversed" }, targets),
      "PAYMENT_REVERSED",
    );
    const first = targets[0];
    if (first === undefined) throw new Error("Missing fixture");
    code(allocateOldestFirst(payment(), [first, first]), "INVALID_INPUT");
    code(
      allocateOldestFirst(payment(), [
        { ...first, balance_fils: fils.parse(-1) },
      ]),
      "INVALID_INPUT",
    );
    code(
      allocateOldestFirst(payment(), [
        { ...first, contract_id: contractId.parse(uuid(2)) },
      ]),
      "INVALID_INPUT",
    );
  });
});

describe("money decision authorization and recording", () => {
  it.each([
    { ...context, role: "tenant" as const },
    { ...context, company_id: otherCompany },
  ])("refuses unauthorized ledger decisions without mutation", (actor) => {
    const state = ledger();
    for (const result of [
      allocate(state, allocation(), actor),
      voidAllocation(state, { allocation_id: allocation().id }, actor),
      reversePayment(
        state,
        { payment_id: payment().id, reason_code: "bounced", reason: "Return" },
        actor,
      ),
      recordRefund(
        state,
        {
          payment_id: payment().id,
          amount_fils: fils.parse(1),
          reason: "Return",
        },
        actor,
      ),
      closeInstalment(
        state,
        {
          instalment_id: instalmentId.parse(uuid(1)),
          status: "waived",
          reason: "Agreement",
        },
        actor,
      ),
      recordPayment(
        state,
        {
          payment: payment(2),
          receipt_id: receiptId.parse(uuid(2)),
          external: null,
        },
        actor,
      ),
    ])
      code(result, "FORBIDDEN");
    expect(state).toEqual(ledger());
  });
  it("records payment and receipt atomically and validates payment shape", () => {
    const command = {
      payment: payment(2),
      receipt_id: receiptId.parse(uuid(2)),
      external: null,
    };
    expect(
      value(
        recordPayment(ledger(), command, { ...context, role: "accountant" }),
      ).receipts,
    ).toHaveLength(2);
    code(
      recordPayment(ledger(), { ...command, payment: payment() }, context),
      "INVALID_INPUT",
    );
    code(
      recordPayment(ledger(), { ...command, payment: payment(2, 0) }, context),
      "INVALID_INPUT",
    );
    code(
      recordPayment(
        ledger(),
        { ...command, payment: { ...payment(2), status: "reversed" } },
        context,
      ),
      "INVALID_INPUT",
    );
    code(
      recordPayment(
        ledger(),
        { ...command, payment: { ...payment(2), method: "cheque" } },
        context,
      ),
      "INVALID_INPUT",
    );
    expect(paymentsErrorCode.safeParse("EARLY_DEPOSIT").success).toBe(true);
  });
});

it("AC-5 conserves C1 and C2 after every random accepted operation and preserves refused inputs", () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 1, max: 300 }), {
        minLength: 3,
        maxLength: 3,
      }),
      fc.array(
        fc.record({
          kind: fc.integer({ min: 0, max: 3 }),
          payment: fc.integer({ min: 1, max: 3 }),
          target: fc.integer({ min: 1, max: 3 }),
          amount: fc.integer({ min: 1, max: 150 }),
        }),
        { minLength: 20, maxLength: 80 },
      ),
      (amounts, operations) => {
        let state: MoneyLedger = {
          ...ledger(),
          payments: amounts.map((amount, i) => payment(i + 1, amount)),
          receipts: amounts.map((_, i) => receipt(i + 1)),
          instalments: amounts.flatMap((amount, i) =>
            ledger().instalments.map((item) => ({
              ...item,
              id: instalmentId.parse(uuid(i + 1)),
              amount_fils: fils.parse(amount),
            })),
          ),
        };
        for (const [index, operation] of operations.entries()) {
          const before = JSON.stringify(state);
          const id = paymentId.parse(uuid(operation.payment));
          const choices = [
            () =>
              allocate(
                state,
                {
                  ...allocation(index + 1, operation.amount),
                  payment_id: id,
                  instalment_id: instalmentId.parse(uuid(operation.target)),
                },
                context,
              ),
            () =>
              voidAllocation(
                state,
                {
                  allocation_id:
                    state.allocations[operation.target - 1]?.id ??
                    allocation(index + 1).id,
                },
                context,
              ),
            () =>
              reversePayment(
                state,
                {
                  payment_id: id,
                  reason_code: "recorded_in_error",
                  reason: "Correction",
                },
                context,
              ),
            () =>
              recordRefund(
                state,
                {
                  payment_id: id,
                  amount_fils: fils.parse(operation.amount),
                  reason: "Return excess",
                },
                context,
              ),
          ];
          const run = choices[operation.kind];
          if (run === undefined) throw new Error("Missing command");
          const result = run();
          expect(JSON.stringify(state)).toBe(before);
          if (result.ok) state = result.value;
          invariants(state);
        }
      },
    ),
    { seed: 20260928, numRuns: 100 },
  );
}, 60_000);

it("AC-6 twenty requests in arbitrary order never overallocate one instalment", () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 1, max: 200 }), {
        minLength: 20,
        maxLength: 20,
      }),
      fc.shuffledSubarray(
        Array.from({ length: 20 }, (_, i) => i),
        { minLength: 20, maxLength: 20 },
      ),
      (amounts, order) => {
        let state: MoneyLedger = {
          ...ledger(),
          payments: amounts.map((_, i) => payment(i + 1, 200)),
          receipts: amounts.map((_, i) => receipt(i + 1)),
        };
        for (const i of order) {
          const amount = amounts[i];
          if (amount === undefined) throw new Error("Missing amount");
          const result = allocate(
            state,
            { ...allocation(i + 1, amount), payment_id: payment(i + 1).id },
            context,
          );
          if (result.ok) state = result.value;
          invariants(state);
        }
      },
    ),
    { seed: 20260929, numRuns: 100 },
  );
}, 60_000);

it("reports the refusal code when a success-only fixture assertion receives a refusal", () => {
  expect(() => value(allocate(ledger(), allocation(1, 0), context))).toThrow(
    "INVALID_INPUT",
  );
});

describe("charge status vocabulary", () => {
  it.each(["open", "invoiced"] as const)(
    "restores %s after a full allocation including VAT is voided",
    (status) => {
      const initial = ledger();
      const state: MoneyLedger = {
        ...initial,
        payments: [payment(1, 210)],
        charges: initial.charges.map((charge) => ({
          ...charge,
          status,
          vat_fils: fils.parse(10),
        })),
      };
      const command = {
        ...allocation(1, 210),
        instalment_id: null,
        charge_id: chargeId.parse(uuid(1)),
      };
      const partial = value(
        allocate(state, { ...command, amount_fils: fils.parse(209) }, context),
      );
      expect(partial.charges[0]?.status).toBe(status);
      const settled = value(allocate(state, command, context));
      expect(settled.charges[0]?.status).toBe("settled");
      const restored = value(
        voidAllocation(settled, { allocation_id: command.id }, context),
      );
      expect(restored.charges[0]?.status).toBe(status);
      expect(state.charges[0]?.status).toBe(status);
    },
  );
  it.each(["waived", "cancelled"] as const)("retains explicit %s", (status) => {
    for (const charge of ledger().charges) {
      expect(deriveChargeStatus({ ...charge, status }, fils.parse(200))).toBe(
        status,
      );
    }
  });
  it("defaults an imported settled charge without prior state to open", () => {
    for (const charge of ledger().charges) {
      expect(
        deriveChargeStatus({ ...charge, status: "settled" }, fils.parse(0)),
      ).toBe("open");
    }
  });
});
