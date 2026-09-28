import { describe, expect, it } from "vitest";
import { chequeId, paymentId, receiptId } from "../ids";
import { fils } from "../money";
import { localDate } from "../time";
import type { ChequeStatus } from "../vocabulary";
import {
  allocate,
  chequeTransitions,
  isChequeStale,
  transitionCheque,
  type ChequeCommand,
  type MoneyLedger,
} from "./index";
import {
  allocation,
  cheque,
  context,
  ledger,
  otherCompany,
  payment,
  receipt,
  uuid,
  value,
} from "./test-support";

function command(to: ChequeCommand["to"]): ChequeCommand {
  switch (to) {
    case "received":
    case "returned_to_drawer":
      return { to };
    case "deposited":
      return { to, deposited_on: context.on };
    case "replaced":
      return {
        to,
        replacement_reference: "Transfer reference SYNTHETIC-2",
        replacement_cheque: null,
      };
    case "cleared":
    case "partly_paid":
      return {
        to,
        paid_fils: fils.parse(to === "cleared" ? 100 : 40),
        payment_id: paymentId.parse(uuid(2)),
        receipt_id: receiptId.parse(uuid(2)),
      };
    case "bounced":
      return {
        to,
        reversal: {
          payment_id: payment().id,
          reason_code: "bounced",
          reason: "Bank return",
        },
      };
  }
}
function chequeLedger(): MoneyLedger {
  return {
    ...ledger(),
    payments: [{ ...payment(), method: "cheque", cheque_id: cheque().id }],
  };
}
const transitions: readonly (readonly [ChequeStatus, ChequeCommand["to"]])[] = [
  ["pending", "received"],
  ["pending", "replaced"],
  ["received", "deposited"],
  ["received", "replaced"],
  ["received", "returned_to_drawer"],
  ["deposited", "cleared"],
  ["deposited", "partly_paid"],
  ["deposited", "bounced"],
  ["bounced", "deposited"],
  ["bounced", "replaced"],
  ["partly_paid", "replaced"],
  ["cleared", "bounced"],
];

describe("cheque lifecycle", () => {
  it.each(transitions)(
    "AC-1 allows %s to %s and refuses a wrong state",
    (from, to) => {
      const state = {
        cheque: { ...cheque(), status: from },
        ledger: from === "cleared" ? chequeLedger() : ledger(),
      };
      const before = JSON.stringify(state);
      const next = value(transitionCheque(state, command(to), context));
      expect(next.cheque.status).toBe(to);
      expect(chequeTransitions[from]).toContain(to);
      expect(
        transitionCheque(
          { ...state, cheque: { ...state.cheque, status: "replaced" } },
          command(to),
          context,
        ),
      ).toMatchObject({ ok: false, error: { code: "INVALID_TRANSITION" } });
      expect(JSON.stringify(state)).toBe(before);
      if (to === "cleared" || to === "partly_paid")
        expect(next.ledger.payments[1]).toMatchObject({
          method: "cheque",
          source: "app",
          amount_fils: to === "cleared" ? 100 : 40,
        });
    },
  );
  it.each(["received", "bounced"] as const)(
    "AC-1 blocks early deposit from %s and allows the cheque date",
    (status) => {
      const state = { cheque: { ...cheque(), status }, ledger: ledger() };
      expect(
        transitionCheque(
          state,
          { to: "deposited", deposited_on: localDate.parse("2026-03-27") },
          context,
        ),
      ).toMatchObject({ ok: false, error: { code: "EARLY_DEPOSIT" } });
      expect(
        value(
          transitionCheque(
            state,
            { to: "deposited", deposited_on: cheque().cheque_date },
            context,
          ),
        ).cheque.deposited_on,
      ).toBe(cheque().cheque_date);
    },
  );
  it("AC-2 returns a cleared cheque with an atomic full reversal", () => {
    const state = {
      cheque: { ...cheque(), status: "cleared" as const },
      ledger: value(allocate(chequeLedger(), allocation(), context)),
    };
    expect(
      transitionCheque(state, { to: "bounced", reversal: null }, context),
    ).toMatchObject({ ok: false, error: { code: "REVERSAL_REQUIRED" } });
    const next = value(transitionCheque(state, command("bounced"), context));
    expect(next.cheque.status).toBe("bounced");
    expect(next.ledger.payments[0]?.status).toBe("reversed");
    expect(next.ledger.allocations[0]?.status).toBe("voided");
    expect(next.ledger.instalments[0]?.status).toBe("open");
    expect(next.ledger.receipts[0]).toMatchObject({
      status: "voided",
      number: "RCPT-000001",
    });
    expect(next.ledger.reversals[0]?.reason_code).toBe("bounced");
  });
  it("AC-2 a deposited cheque returned unpaid creates no payment or reversal", () => {
    const state = {
      cheque: { ...cheque(), status: "deposited" as const },
      ledger: { ...ledger(), payments: [], receipts: [] },
    };
    const next = value(
      transitionCheque(state, { to: "bounced", reversal: null }, context),
    );
    expect(next.ledger).toEqual(state.ledger);
  });
  it.each([
    ["received", "2026-09-27", false],
    ["received", "2026-09-28", true],
    ["pending", "2026-09-29", true],
    ["cleared", "2026-09-28", false],
    ["bounced", "2026-09-28", false],
  ] as const)("AC-3 stale flag for %s on %s is %s", (status, on, expected) => {
    expect(
      isChequeStale({
        cheque: { ...cheque(), status },
        on: localDate.parse(on),
      }),
    ).toBe(expected);
  });
  it("staleness flags do not block receipt and replacement links the new instrument", () => {
    expect(
      value(
        transitionCheque(
          { cheque: cheque(), ledger: ledger() },
          { to: "received" },
          context,
        ),
      ).cheque.status,
    ).toBe("received");
    const replacement = {
      ...cheque(),
      id: chequeId.parse(uuid(2)),
      replaces_cheque_id: cheque().id,
    };
    const next = value(
      transitionCheque(
        { cheque: cheque(), ledger: ledger() },
        {
          to: "replaced",
          replacement_reference: " Replacement 2 ",
          replacement_cheque: replacement,
        },
        context,
      ),
    );
    expect(next.replacement_cheque).toEqual(replacement);
    expect(next.cheque.replacement_reference).toBe("Replacement 2");
  });
  it.each([0, -1, 101])(
    "rejects invalid clearance paid amount %s",
    (amount) => {
      expect(
        transitionCheque(
          { cheque: { ...cheque(), status: "deposited" }, ledger: ledger() },
          {
            to: "cleared",
            paid_fils: fils.parse(amount),
            payment_id: payment(2).id,
            receipt_id: receiptId.parse(uuid(2)),
          },
          context,
        ),
      ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    },
  );
  it.each([
    ["cleared", 99],
    ["partly_paid", 100],
  ] as const)("rejects %s with inconsistent amount %s", (to, amount) => {
    expect(
      transitionCheque(
        { cheque: { ...cheque(), status: "deposited" }, ledger: ledger() },
        {
          to,
          paid_fils: fils.parse(amount),
          payment_id: payment(2).id,
          receipt_id: receiptId.parse(uuid(2)),
        },
        context,
      ).ok,
    ).toBe(false);
  });
  it("rejects missing target, duplicate cheque payment and receipt refusal without changing state", () => {
    for (const state of [
      { ...ledger(), instalments: [] },
      chequeLedger(),
      {
        ...ledger(),
        receipts: [receipt(2)],
      },
    ]) {
      const before = JSON.stringify(state);
      expect(
        transitionCheque(
          { cheque: { ...cheque(), status: "deposited" }, ledger: state },
          command("cleared"),
          context,
        ).ok,
      ).toBe(false);
      expect(JSON.stringify(state)).toBe(before);
    }
  });
  it("checks actor, company and positive instrument amount", () => {
    for (const actor of [
      { ...context, role: "tenant" as const },
      { ...context, company_id: otherCompany },
    ])
      expect(
        transitionCheque(
          { cheque: cheque(), ledger: ledger() },
          command("received"),
          actor,
        ),
      ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(
      transitionCheque(
        {
          cheque: { ...cheque(), amount_fils: fils.parse(0) },
          ledger: ledger(),
        },
        command("received"),
        context,
      ).ok,
    ).toBe(false);
  });
  it("refuses invalid replacement references and instruments", () => {
    expect(
      transitionCheque(
        { cheque: cheque(), ledger: ledger() },
        {
          to: "replaced",
          replacement_reference: " ",
          replacement_cheque: null,
        },
        context,
      ).ok,
    ).toBe(false);
    const good = {
      ...cheque(),
      id: chequeId.parse(uuid(2)),
      replaces_cheque_id: cheque().id,
    };
    for (const replacement of [
      cheque(),
      { ...good, replaces_cheque_id: null },
      {
        ...good,
        instalment_id:
          { ...ledger().instalments[0] }.id ?? cheque().instalment_id,
        amount_fils: fils.parse(0),
      },
    ])
      expect(
        transitionCheque(
          { cheque: cheque(), ledger: ledger() },
          {
            to: "replaced",
            replacement_reference: "Replacement",
            replacement_cheque: replacement,
          },
          context,
        ).ok,
      ).toBe(false);
  });
  it("refuses a reversal unrelated to the cleared cheque and propagates refund refusal", () => {
    const reversal = {
      payment_id: payment().id,
      reason_code: "bounced" as const,
      reason: "Bank return",
    };
    for (const state of [
      ledger(),
      { ...chequeLedger(), payments: [] },
      {
        ...chequeLedger(),
        payments: [{ ...payment(), cheque_id: cheque().id }],
      },
      {
        ...chequeLedger(),
        payments: [
          {
            ...payment(),
            method: "cheque" as const,
            cheque_id: cheque().id,
            amount_fils: fils.parse(90),
          },
        ],
      },
    ])
      expect(
        transitionCheque(
          { cheque: { ...cheque(), status: "cleared" }, ledger: state },
          { to: "bounced", reversal },
          context,
        ).ok,
      ).toBe(false);
    expect(
      transitionCheque(
        { cheque: { ...cheque(), status: "cleared" }, ledger: chequeLedger() },
        {
          to: "bounced",
          reversal: { ...reversal, reason_code: "recorded_in_error" },
        },
        context,
      ).ok,
    ).toBe(false);
    expect(
      transitionCheque(
        {
          cheque: { ...cheque(), status: "cleared" },
          ledger: {
            ...chequeLedger(),
            refunds: [
              {
                payment_id: payment().id,
                amount_fils: fils.parse(1),
                reason: "Return",
              },
            ],
          },
        },
        { to: "bounced", reversal },
        context,
      ),
    ).toMatchObject({ ok: false, error: { code: "PAYMENT_HAS_REFUNDS" } });
  });
});
