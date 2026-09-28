import { describe, expect, it } from "vitest";
import { documentVersionId, receiptId } from "../ids";
import {
  formatDocumentNumber,
  issueReceipt,
  recordPayment,
  reversePayment,
  takeNumber,
  voidReceipt,
  type MoneyLedger,
} from "./index";
import {
  context,
  documentVersion,
  ledger,
  otherCompany,
  payment,
  receipt,
  uuid,
  value,
} from "./test-support";

const external = {
  external_issuer: "Example Issuer",
  external_receipt_no: "EXT-001",
  document_version_id: documentVersion,
};
function externalLedger(): MoneyLedger {
  return {
    ...ledger(),
    payments: [
      { ...payment(), source: "external" },
      { ...payment(2), source: "external" },
    ],
    receipts: [],
  };
}

describe("one receipt per payment", () => {
  it("AC-7 app payment plans exactly one RCPT receipt with company issuer and TRN", () => {
    const state = { ...ledger(), receipts: [] };
    const next = value(
      issueReceipt(
        state,
        {
          id: receiptId.parse(uuid(1)),
          payment_id: payment().id,
          external: null,
        },
        context,
      ),
    );
    expect(next.receipts).toHaveLength(1);
    expect(next.receipts[0]).toMatchObject({
      source: "app",
      number: "RCPT-000002",
      issuer_name: context.company_name,
      issuer_trn: context.issuer_trn,
    });
    expect(
      issueReceipt(
        next,
        {
          id: receiptId.parse(uuid(2)),
          payment_id: payment().id,
          external: null,
        },
        context,
      ),
    ).toMatchObject({ ok: false, error: { code: "RECEIPT_ALREADY_ISSUED" } });
  });
  it("AC-7 external payment attaches its document and plans no app receipt", () => {
    const state = externalLedger();
    const next = value(
      issueReceipt(
        state,
        { id: receiptId.parse(uuid(1)), payment_id: payment().id, external },
        context,
      ),
    );
    expect(next.receipts.filter((r) => r.source === "app")).toHaveLength(0);
    expect(next.receipts[0]).toMatchObject({ source: "external", ...external });
    expect(next.counters).toEqual(state.counters);
    const before = JSON.stringify(next);
    expect(
      issueReceipt(
        next,
        {
          id: receiptId.parse(uuid(2)),
          payment_id: payment(2).id,
          external: { ...external, external_issuer: " Example Issuer " },
        },
        context,
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "DUPLICATE_EXTERNAL_RECEIPT" },
    });
    expect(JSON.stringify(next)).toBe(before);
    expect(
      issueReceipt(
        next,
        { id: receiptId.parse(uuid(2)), payment_id: payment().id, external },
        context,
      ),
    ).toMatchObject({ ok: false, error: { code: "RECEIPT_ALREADY_ISSUED" } });
    const reversed = value(
      reversePayment(
        next,
        {
          payment_id: payment().id,
          reason_code: "recorded_in_error",
          reason: "Correction",
        },
        context,
      ),
    );
    expect(reversed.receipts).toEqual(next.receipts);
  });
  it("external uniqueness is company scoped and permits a different issuer or number", () => {
    const first = value(
      issueReceipt(
        externalLedger(),
        { id: receiptId.parse(uuid(1)), payment_id: payment().id, external },
        context,
      ),
    );
    for (const identity of [
      { ...external, external_issuer: "Another Issuer" },
      { ...external, external_receipt_no: "EXT-002" },
    ])
      expect(
        issueReceipt(
          first,
          {
            id: receiptId.parse(uuid(2)),
            payment_id: payment(2).id,
            external: identity,
          },
          context,
        ).ok,
      ).toBe(true);
    expect(
      issueReceipt(
        {
          ...first,
          receipts: first.receipts.map((r) => ({
            ...r,
            company_id: otherCompany,
          })),
        },
        { id: receiptId.parse(uuid(2)), payment_id: payment(2).id, external },
        context,
      ).ok,
    ).toBe(true);
  });
  it.each([
    null,
    { ...external, external_issuer: " " },
    { ...external, external_receipt_no: " " },
  ])("requires complete external identity %s", (identity) => {
    expect(
      issueReceipt(
        externalLedger(),
        {
          id: receiptId.parse(uuid(1)),
          payment_id: payment().id,
          external: identity,
        },
        context,
      ),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  });
  it("refuses unauthorized, unknown, reversed and duplicate identity receipt requests", () => {
    const command = {
      id: receiptId.parse(uuid(1)),
      payment_id: payment().id,
      external: null,
    };
    expect(
      issueReceipt(ledger(), command, { ...context, role: "tenant" }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(
      issueReceipt({ ...ledger(), payments: [] }, command, context).ok,
    ).toBe(false);
    expect(
      issueReceipt(
        {
          ...ledger(),
          receipts: [],
          payments: [{ ...payment(), status: "reversed" }],
        },
        command,
        context,
      ),
    ).toMatchObject({ ok: false, error: { code: "PAYMENT_REVERSED" } });
    expect(
      issueReceipt(
        {
          ...ledger(),
          receipts: [{ ...receipt(), payment_id: payment(2).id }],
        },
        command,
        context,
      ).ok,
    ).toBe(false);
    expect(
      issueReceipt(
        { ...ledger(), receipts: [] },
        { ...command, external },
        context,
      ).ok,
    ).toBe(false);
    expect(
      issueReceipt({ ...ledger(), receipts: [] }, command, {
        ...context,
        company_name: " ",
      }).ok,
    ).toBe(false);
    expect(
      issueReceipt(
        {
          ...ledger(),
          receipts: [],
          counters: [
            { company_id: context.company_id, series: "RCPT", next: 0 },
          ],
        },
        command,
        context,
      ).ok,
    ).toBe(false);
  });
  it("issued app receipts void only with a reason and never reclaim a number", () => {
    const original = receipt();
    const next = value(
      voidReceipt(original, { reason: " Recorded in error " }, context),
    );
    expect(next).toMatchObject({
      status: "voided",
      void_reason: "Recorded in error",
      number: "RCPT-000001",
    });
    expect(original.status).toBe("issued");
    expect(voidReceipt(original, { reason: " " }, context)).toMatchObject({
      ok: false,
      error: { code: "REASON_REQUIRED" },
    });
    expect(voidReceipt(next, { reason: "Again" }, context).ok).toBe(false);
    expect(
      voidReceipt(
        original,
        { reason: "Correction" },
        { ...context, role: "tenant" },
      ).ok,
    ).toBe(false);
    const externalReceipt = value(
      issueReceipt(
        externalLedger(),
        { id: receiptId.parse(uuid(1)), payment_id: payment().id, external },
        context,
      ),
    ).receipts[0];
    if (externalReceipt === undefined) throw new Error("Missing receipt");
    expect(
      voidReceipt(externalReceipt, { reason: "Correction" }, context).ok,
    ).toBe(false);
  });
});

describe("document numbering", () => {
  it.each([
    ["INV", 123, "INV-000123"],
    ["RCPT", 1234567, "RCPT-1234567"],
    ["CN", 1, "CN-000001"],
    ["STMT", 9, "STMT-000009"],
  ] as const)("AC-8 formats %s sequence %s", (series, n, expected) => {
    expect(formatDocumentNumber(series, n)).toBe(expected);
  });
  it("AC-8 twelve issues with five forced rollbacks commit numbers one through seven", () => {
    let state: MoneyLedger = {
      ...ledger(),
      payments: [],
      receipts: [],
      counters: [],
    };
    const rollbacks = new Set([1, 3, 5, 7, 9]);
    for (let i = 0; i < 12; i += 1) {
      const proposed = value(
        recordPayment(
          state,
          {
            payment: payment(i + 1),
            receipt_id: receiptId.parse(uuid(i + 1)),
            external: null,
          },
          context,
        ),
      );
      if (!rollbacks.has(i)) state = proposed;
    }
    expect(
      state.receipts.map((r) => (r.source === "app" ? r.number : "external")),
    ).toEqual(
      Array.from({ length: 7 }, (_, i) => formatDocumentNumber("RCPT", i + 1)),
    );
    expect(state.counters[0]?.next).toBe(8);
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1])(
    "refuses invalid counter %s without advancing",
    (next) => {
      expect(
        takeNumber(
          { company_id: context.company_id, series: "INV", next },
          { series: "INV" },
          context,
        ),
      ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    },
  );
  it("isolates company and series counters", () => {
    const counter = {
      company_id: context.company_id,
      series: "INV" as const,
      next: 1,
    };
    expect(takeNumber(counter, { series: "CN" }, context).ok).toBe(false);
    expect(
      takeNumber(
        counter,
        { series: "INV" },
        { ...context, company_id: otherCompany },
      ).ok,
    ).toBe(false);
    expect(
      value(takeNumber(counter, { series: "INV" }, context)).next_counter.next,
    ).toBe(2);
    expect(counter.next).toBe(1);
  });
  it("validates external document version brands at the input boundary", () => {
    expect(documentVersionId.safeParse("").success).toBe(false);
  });
});
