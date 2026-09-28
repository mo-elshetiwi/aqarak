import { describe, expect, it } from "vitest";
import {
  chargeId,
  creditNoteId,
  instalmentId,
  invoiceId,
  invoiceLineId,
} from "../ids";
import { basisPoints, fils } from "../money";
import {
  allocate,
  deriveInvoiceStatus,
  editInvoice,
  invoiceTotals,
  issueCreditNote,
  issueInvoice,
  type Invoice,
  type InvoiceBook,
  type InvoiceLine,
  type MoneyLedger,
} from "./index";
import {
  allocation,
  context,
  ledger,
  otherCompany,
  payment,
  uuid,
  value,
} from "./test-support";

function line(n = 1, amount = 10000): InvoiceLine {
  return {
    id: invoiceLineId.parse(uuid(n)),
    instalment_id: instalmentId.parse(uuid(n)),
    charge_id: null,
    amount_fils: fils.parse(amount),
    vat_bp: basisPoints.parse(500),
    unit_use: "commercial",
  };
}
function invoice(): Invoice {
  return {
    id: invoiceId.parse(uuid(1)),
    company_id: context.company_id,
    status: "draft",
    lines: [line()],
    number: null,
    issuer_name: context.company_name,
    issuer_trn: context.issuer_trn,
  };
}
function book(): InvoiceBook {
  return {
    company_id: context.company_id,
    invoices: [invoice()],
    credit_notes: [],
    counters: [],
  };
}
function invoiceLedger(amount = 0): MoneyLedger {
  const state = {
    ...ledger(),
    payments: [payment(1, 10500)],
    instalments: ledger().instalments.map((item) => ({
      ...item,
      amount_fils: fils.parse(10000),
      vat_fils: fils.parse(500),
    })),
  };
  return amount === 0
    ? state
    : value(allocate(state, allocation(1, amount), context));
}
function issued(): InvoiceBook {
  return value(issueInvoice(book(), { invoice_id: invoice().id }, context));
}

it("AC-9 rounds commercial line VAT before summing the document", () => {
  expect(
    value(invoiceTotals([line(1), line(2, 12345)], context.issuer_trn)),
  ).toEqual({
    line_vat_fils: [500, 617],
    amount_fils: 22345,
    vat_fils: 1117,
    total_fils: 23462,
  });
});
it.each(["residential", "commercial"] as const)(
  "AC-9 applies zero VAT for %s when there is no TRN",
  (unit_use) => {
    const lines = [{ ...line(), unit_use, vat_bp: basisPoints.parse(0) }];
    expect(value(invoiceTotals(lines, null)).vat_fils).toBe(0);
    if (unit_use === "residential")
      expect(value(invoiceTotals(lines, context.issuer_trn)).vat_fils).toBe(0);
  },
);
it.each([
  [0, "issued"],
  [5250, "partly_paid"],
  [10500, "paid"],
] as const)("AC-9 C3 derives %s allocated as %s", (amount, status) => {
  expect(
    value(
      deriveInvoiceStatus(
        { ...invoice(), status: "issued" },
        invoiceLedger(amount),
        [],
      ),
    ),
  ).toBe(status);
});
it("AC-9 a draft stays draft even with allocations", () => {
  expect(value(deriveInvoiceStatus(invoice(), invoiceLedger(10500), []))).toBe(
    "draft",
  );
});
it.each([
  [0, 10000],
  [5250, 5000],
])(
  "AC-9 full value or unpaid balance credit marks the invoice credited",
  (allocated, amount) => {
    const state = issued();
    const next = value(
      issueCreditNote(
        state,
        {
          id: creditNoteId.parse(uuid(1)),
          invoice_id: invoice().id,
          lines: [line(1, amount)],
        },
        context,
        invoiceLedger(allocated),
      ),
    );
    expect(next.invoices[0]?.status).toBe("credited");
    expect(next.credit_notes[0]?.number).toBe("CN-000001");
    expect(next.credit_notes[0]?.totals.total_fils).toBe(10500 - allocated);
    expect(next.credit_notes[0]?.issuer_name).toBe(context.company_name);
    expect(state.credit_notes).toHaveLength(0);
  },
);

describe("invoice validation and immutability", () => {
  it("issues in company name, consumes INV and prevents editing or reissuing", () => {
    const state = book();
    const edited = value(
      editInvoice(invoice(), { lines: [line(1, 20000)] }, context),
    );
    expect(edited.lines[0]?.amount_fils).toBe(20000);
    const next = value(
      issueInvoice(state, { invoice_id: invoice().id }, context),
    );
    const document = next.invoices[0];
    if (document === undefined) throw new Error("Missing invoice");
    expect(document).toMatchObject({
      number: "INV-000001",
      status: "issued",
      issuer_name: context.company_name,
      issuer_trn: context.issuer_trn,
    });
    expect(editInvoice(document, { lines: [] }, context)).toMatchObject({
      ok: false,
      error: { code: "INVALID_TRANSITION" },
    });
    expect(issueInvoice(next, { invoice_id: invoice().id }, context).ok).toBe(
      false,
    );
    expect(state.invoices[0]?.status).toBe("draft");
    const withAnother = {
      ...next,
      invoices: [
        ...next.invoices,
        { ...invoice(), id: invoiceId.parse(uuid(2)) },
      ],
    };
    expect(
      value(
        issueInvoice(
          withAnother,
          { invoice_id: invoiceId.parse(uuid(2)) },
          context,
        ),
      ).invoices[1]?.number,
    ).toBe("INV-000002");
  });
  it.each(
    [
      [],
      [line(), line()],
      [{ ...line(), amount_fils: fils.parse(-1) }],
      [{ ...line(), vat_bp: basisPoints.parse(0) }],
      [{ ...line(), instalment_id: null }],
      [{ ...line(), charge_id: chargeId.parse(uuid(1)) }],
      [line(), { ...line(2), id: line().id }],
    ].map((lines) => ({ lines })),
  )("refuses malformed or inconsistent invoice lines", ({ lines }) => {
    expect(invoiceTotals(lines, context.issuer_trn)).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
  });
  it("handles maximum amounts without throwing on document overflow", () => {
    const maxLine = {
      ...line(),
      amount_fils: fils.parse(Number.MAX_SAFE_INTEGER),
    };
    expect(invoiceTotals([maxLine], context.issuer_trn).ok).toBe(false);
    expect(
      invoiceTotals(
        [
          maxLine,
          {
            ...maxLine,
            id: invoiceLineId.parse(uuid(2)),
            instalment_id: instalmentId.parse(uuid(2)),
          },
        ],
        context.issuer_trn,
      ).ok,
    ).toBe(false);
    expect(
      invoiceTotals(
        [{ ...maxLine, vat_bp: basisPoints.parse(0), unit_use: "residential" }],
        null,
      ).ok,
    ).toBe(true);
  });
  it("refuses unauthorized documents, missing invoices and malformed edits", () => {
    const actor = { ...context, company_id: otherCompany };
    expect(editInvoice(invoice(), { lines: [line()] }, actor).ok).toBe(false);
    expect(issueInvoice(book(), { invoice_id: invoice().id }, actor).ok).toBe(
      false,
    );
    expect(
      issueInvoice(
        { ...book(), invoices: [] },
        { invoice_id: invoice().id },
        context,
      ).ok,
    ).toBe(false);
    expect(
      issueInvoice(
        { ...book(), invoices: [{ ...invoice(), company_id: otherCompany }] },
        { invoice_id: invoice().id },
        context,
      ).ok,
    ).toBe(false);
    expect(
      issueInvoice(
        book(),
        { invoice_id: invoice().id },
        { ...context, company_name: " " },
      ).ok,
    ).toBe(false);
    expect(
      issueInvoice(
        { ...book(), invoices: [{ ...invoice(), lines: [] }] },
        { invoice_id: invoice().id },
        context,
      ).ok,
    ).toBe(false);
    expect(editInvoice(invoice(), { lines: [] }, context).ok).toBe(false);
    expect(
      issueInvoice(
        {
          ...book(),
          counters: [
            { company_id: context.company_id, series: "INV", next: 0 },
          ],
        },
        { invoice_id: invoice().id },
        context,
      ).ok,
    ).toBe(false);
    expect(
      deriveInvoiceStatus(
        { ...invoice(), status: "issued" },
        { ...ledger(), company_id: otherCompany },
        [],
      ).ok,
    ).toBe(false);
    expect(
      deriveInvoiceStatus(
        { ...invoice(), status: "issued", lines: [] },
        ledger(),
        [],
      ).ok,
    ).toBe(false);
  });
  it("uses charge allocations and excludes unrelated targets", () => {
    const inv = {
      ...invoice(),
      status: "issued" as const,
      lines: [
        {
          ...line(),
          instalment_id: null,
          charge_id: chargeId.parse(uuid(1)),
          amount_fils: fils.parse(100),
          vat_bp: basisPoints.parse(0),
          unit_use: "residential" as const,
        },
      ],
    };
    const state = value(
      allocate(
        ledger(),
        {
          ...allocation(),
          instalment_id: null,
          charge_id: chargeId.parse(uuid(1)),
        },
        context,
      ),
    );
    expect(value(deriveInvoiceStatus(inv, state, []))).toBe("paid");
  });
});

describe("credit note boundaries", () => {
  it("partial credits preserve issued status and repeated credits share the CN counter", () => {
    const state = {
      ...issued(),
      invoices: [
        ...issued().invoices,
        { ...invoice(), id: invoiceId.parse(uuid(2)) },
      ],
    };
    const command = {
      id: creditNoteId.parse(uuid(1)),
      invoice_id: invoice().id,
      lines: [line(1, 4000)],
    };
    const first = value(
      issueCreditNote(state, command, context, invoiceLedger()),
    );
    expect(first.invoices[0]?.status).toBe("issued");
    const next = value(
      issueCreditNote(
        first,
        { ...command, id: creditNoteId.parse(uuid(2)), lines: [line(1, 6000)] },
        context,
        invoiceLedger(),
      ),
    );
    expect(next.invoices[0]?.status).toBe("credited");
    expect(next.credit_notes[1]?.number).toBe("CN-000002");
    expect(next.invoices[1]).toEqual(state.invoices[1]);
    expect(issueCreditNote(first, command, context, invoiceLedger()).ok).toBe(
      false,
    );
    expect(
      issueCreditNote(
        first,
        { ...command, id: creditNoteId.parse(uuid(2)), lines: [line(1, 6001)] },
        context,
        invoiceLedger(),
      ).ok,
    ).toBe(false);
    expect(
      issueCreditNote(
        next,
        { ...command, id: creditNoteId.parse(uuid(3)) },
        context,
        invoiceLedger(),
      ).ok,
    ).toBe(false);
  });
  it("refuses credit from draft or paid, wrong company or absent invoice", () => {
    const command = {
      id: creditNoteId.parse(uuid(1)),
      invoice_id: invoice().id,
      lines: [line()],
    };
    expect(issueCreditNote(book(), command, context, invoiceLedger()).ok).toBe(
      false,
    );
    expect(
      issueCreditNote(issued(), command, context, invoiceLedger(10500)).ok,
    ).toBe(false);
    expect(
      issueCreditNote(
        issued(),
        command,
        { ...context, company_id: otherCompany },
        invoiceLedger(),
      ).ok,
    ).toBe(false);
    expect(
      issueCreditNote(
        { ...issued(), invoices: [] },
        command,
        context,
        invoiceLedger(),
      ).ok,
    ).toBe(false);
    expect(
      issueCreditNote(issued(), command, context, {
        ...invoiceLedger(),
        company_id: otherCompany,
      }).ok,
    ).toBe(false);
    expect(
      issueCreditNote(
        issued(),
        { ...command, lines: [] },
        context,
        invoiceLedger(),
      ).ok,
    ).toBe(false);
  });
  it("refuses altered source identities, amounts and tax classification", () => {
    const command = {
      id: creditNoteId.parse(uuid(1)),
      invoice_id: invoice().id,
      lines: [line()],
    };
    for (const changed of [
      line(2),
      { ...line(), instalment_id: instalmentId.parse(uuid(2)) },
      { ...line(), instalment_id: null, charge_id: chargeId.parse(uuid(1)) },
      {
        ...line(),
        unit_use: "residential" as const,
        vat_bp: basisPoints.parse(0),
      },
      line(1, 10001),
    ])
      expect(
        issueCreditNote(
          issued(),
          { ...command, lines: [changed] },
          context,
          invoiceLedger(),
        ).ok,
      ).toBe(false);
    expect(
      issueCreditNote(issued(), command, context, invoiceLedger(1)).ok,
    ).toBe(false);
    expect(
      issueCreditNote(
        {
          ...issued(),
          counters: [{ company_id: context.company_id, series: "CN", next: 0 }],
        },
        command,
        context,
        invoiceLedger(),
      ).ok,
    ).toBe(false);
  });
});
