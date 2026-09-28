import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { documentVersionId, personAccountId, ticketId } from "../ids";
import { fils } from "../money";
import { utcInstant } from "../time";
import { ticketStatus } from "../vocabulary";
import {
  costApprovalRoute,
  dispatchTransitions,
  effectiveTicketPriority,
  maintenanceErrorCode,
  quoteTransitions,
  rateTicket,
  resolutionDeadline,
  safetyCriticalFlag,
  ticketTransitions,
  transitionDispatch,
  transitionQuote,
  transitionTicket,
  type CostApprovalInput,
  type DispatchCommand,
  type MaintenanceActor,
  type QuoteCommand,
  type TicketCommand,
  type TicketContext,
  type TicketSnapshot,
} from "./index";

const tenant = personAccountId.parse("00000000-0000-4000-8000-000000000001");
const owner = personAccountId.parse("00000000-0000-4000-8000-000000000002");
const managerId = personAccountId.parse("00000000-0000-4000-8000-000000000003");
const photo = documentVersionId.parse("00000000-0000-4000-8000-000000000004");
const manager: MaintenanceActor = {
  role: "manager",
  accountId: managerId,
  sessionAccountId: managerId,
};
const tenantActor: MaintenanceActor = {
  role: "tenant",
  accountId: tenant,
  sessionAccountId: tenant,
};
const ownerActor: MaintenanceActor = {
  role: "owner",
  accountId: owner,
  sessionAccountId: owner,
};
const snapshot: TicketSnapshot = {
  id: ticketId.parse("00000000-0000-4000-8000-000000000005"),
  status: "reported",
  authorAccountId: tenant,
  authorRole: "tenant",
  ownerAccountId: owner,
  reportedAt: utcInstant.parse("2026-09-28T19:30:00Z"),
  category: "ac",
  priority: "routine",
  payer: "owner",
  safetyFlags: [],
  linked_ticket_id: null,
  rating: null,
};
const context: TicketContext = {
  actor: manager,
  cost: {
    costFils: fils.parse(100),
    costThresholdFils: fils.parse(100),
    emergencyLimitFils: fils.parse(200),
    ownerContactAttempts: 1,
    ownerReachable: false,
  },
  ownerApproval: null,
  now: utcInstant.parse("2026-09-30T10:00:00Z"),
  confirmationDeadline: utcInstant.parse("2026-09-30T10:00:00Z"),
};
const commands: Readonly<Record<TicketCommand["type"], TicketCommand>> = {
  report: { type: "report", report: snapshot, confirmed: true },
  triage: {
    type: "triage",
    category: "electrical",
    priority: "urgent",
    payer: "split",
  },
  cancel: { type: "cancel", kind: "duplicate", reason: "Duplicate report" },
  request_quote: { type: "request_quote" },
  request_cost_approval: { type: "request_cost_approval" },
  schedule: { type: "schedule" },
  approve_cost: { type: "approve_cost" },
  reject_cost: { type: "reject_cost", reason: "Amount not accepted" },
  start_visit: { type: "start_visit" },
  hold: { type: "hold", pending: "parts" },
  book_revisit: { type: "book_revisit" },
  complete: { type: "complete", afterPhotos: [photo] },
  reopen: { type: "reopen", reason: "Fault remains" },
  close: {
    type: "close",
    confirmation: "tenant_confirmed",
    costAllocated: true,
  },
};
function contextFor(type: TicketCommand["type"]): TicketContext {
  const actor =
    type === "approve_cost" || type === "reject_cost"
      ? ownerActor
      : type === "report" || type === "reopen" || type === "close"
        ? tenantActor
        : manager;
  return {
    ...context,
    actor,
    cost: {
      ...context.cost,
      costFils: fils.parse(type === "request_cost_approval" ? 101 : 100),
    },
  };
}
function expectCode(
  result: { readonly ok: boolean; readonly error?: { readonly code: string } },
  code: string,
): void {
  expect(result).toMatchObject({ ok: false, error: { code } });
}

describe("ticket lifecycle", () => {
  it.each(ticketTransitions)("AC-1 allows $from / $command / $to", (row) => {
    const before = row.from === null ? null : { ...snapshot, status: row.from };
    const result = transitionTicket(
      before,
      commands[row.command],
      contextFor(row.command),
    );
    expect(result).toMatchObject({
      ok: true,
      value: { ticket: { status: row.to } },
    });
    expect(before?.status ?? null).toBe(row.from);
  });
  it.each(ticketTransitions)(
    "AC-1 refuses $command from a wrong state and from closed",
    (row) => {
      const wrong = ticketStatus.options.find(
        (status) =>
          !ticketTransitions.some(
            (entry) => entry.command === row.command && entry.from === status,
          ),
      );
      if (wrong === undefined) throw new Error("Missing wrong-state fixture");
      expectCode(
        transitionTicket(
          { ...snapshot, status: wrong },
          commands[row.command],
          contextFor(row.command),
        ),
        "INVALID_TRANSITION",
      );
      expectCode(
        transitionTicket(
          { ...snapshot, status: "closed" },
          commands[row.command],
          contextFor(row.command),
        ),
        "INVALID_TRANSITION",
      );
      if (row.command !== "report")
        expectCode(
          transitionTicket(
            null,
            commands[row.command],
            contextFor(row.command),
          ),
          "INVALID_TRANSITION",
        );
    },
  );
  it.each([
    ["reported", "cancel"],
    ["awaiting_cost_approval", "reject_cost"],
    ["work_completed", "reopen"],
  ] as const)("AC-1 requires a reason for %s / %s", (status, type) => {
    const command = commands[type];
    if (!("reason" in command)) throw new Error("Missing reason fixture");
    expectCode(
      transitionTicket(
        { ...snapshot, status },
        { ...command, reason: null },
        contextFor(type),
      ),
      "REASON_REQUIRED",
    );
    expectCode(
      transitionTicket(
        { ...snapshot, status },
        { ...command, reason: "  " },
        contextFor(type),
      ),
      "REASON_REQUIRED",
    );
  });
  it.each(["tenant", "owner", "technician", "manager"] as const)(
    "requires confirmation by the %s report author",
    (role) => {
      const actor = { ...tenantActor, role };
      const report = { ...snapshot, authorRole: role };
      const input = { ...context, actor };
      expect(
        transitionTicket(
          null,
          { type: "report", report, confirmed: true },
          input,
        ).ok,
      ).toBe(true);
      expectCode(
        transitionTicket(
          null,
          { type: "report", report, confirmed: false },
          input,
        ),
        "NOT_AUTHORISED",
      );
    },
  );
  it("binds reports to the author, role, session and distinct linked ticket", () => {
    const input = contextFor("report");
    expectCode(
      transitionTicket(null, commands.report, {
        ...input,
        actor: { ...tenantActor, sessionAccountId: owner },
      }),
      "NOT_OWN_SESSION",
    );
    expectCode(
      transitionTicket(null, commands.report, context),
      "NOT_AUTHORISED",
    );
    expectCode(
      transitionTicket(null, commands.report, {
        ...input,
        actor: { ...tenantActor, role: "owner" },
      }),
      "NOT_AUTHORISED",
    );
    expectCode(
      transitionTicket(
        null,
        {
          type: "report",
          confirmed: true,
          report: { ...snapshot, linked_ticket_id: snapshot.id },
        },
        input,
      ),
      "INVALID_INPUT",
    );
    const linked = ticketId.parse("00000000-0000-4000-8000-000000000099");
    expect(
      transitionTicket(
        null,
        {
          type: "report",
          confirmed: true,
          report: { ...snapshot, linked_ticket_id: linked },
        },
        input,
      ),
    ).toMatchObject({
      ok: true,
      value: { ticket: { linked_ticket_id: linked } },
    });
  });
  it.each(ticketTransitions.filter((row) => row.from !== null))(
    "refuses unauthorised actors for $command",
    (row) => {
      const role =
        row.command === "reopen" || row.command === "close"
          ? "manager"
          : "tenant";
      const input = {
        ...contextFor(row.command),
        actor: { ...manager, role },
      } satisfies TicketContext;
      expectCode(
        transitionTicket(
          { ...snapshot, status: row.from ?? "reported" },
          commands[row.command],
          input,
        ),
        "NOT_AUTHORISED",
      );
    },
  );
  it("requires the named owner in their own session", () => {
    const state = { ...snapshot, status: "awaiting_cost_approval" } as const;
    expectCode(
      transitionTicket(state, commands.approve_cost, {
        ...context,
        actor: {
          ...ownerActor,
          accountId: managerId,
          sessionAccountId: managerId,
        },
      }),
      "NOT_AUTHORISED",
    );
    expectCode(
      transitionTicket(state, commands.approve_cost, {
        ...context,
        actor: { ...ownerActor, sessionAccountId: managerId },
      }),
      "NOT_OWN_SESSION",
    );
  });
  it.each(safetyCriticalFlag.options)(
    "forces emergency priority for %s",
    (flag) => {
      expect(effectiveTicketPriority("routine", [flag])).toBe("emergency");
      expect(
        transitionTicket(
          null,
          {
            type: "report",
            confirmed: true,
            report: { ...snapshot, safetyFlags: [flag] },
          },
          contextFor("report"),
        ),
      ).toMatchObject({
        ok: true,
        value: { ticket: { priority: "emergency" } },
      });
      expect(
        transitionTicket(
          { ...snapshot, safetyFlags: [flag] },
          commands.triage,
          context,
        ),
      ).toMatchObject({
        ok: true,
        value: { ticket: { priority: "emergency" } },
      });
    },
  );
  it("requires an after photo and allows technicians to record work", () => {
    const actor = { ...manager, role: "technician" } as const;
    const state = { ...snapshot, status: "in_progress" } as const;
    expectCode(
      transitionTicket(state, { type: "complete", afterPhotos: [] }, context),
      "AFTER_PHOTO_REQUIRED",
    );
    expect(
      transitionTicket(state, commands.complete, { ...context, actor }).ok,
    ).toBe(true);
  });
  it("requires allocated costs and tenant confirmation or a lapsed window", () => {
    const state = { ...snapshot, status: "work_completed" } as const;
    expectCode(
      transitionTicket(
        state,
        {
          type: "close",
          confirmation: "tenant_confirmed",
          costAllocated: false,
        },
        contextFor("close"),
      ),
      "COST_ALLOCATION_REQUIRED",
    );
    const close: TicketCommand = {
      type: "close",
      confirmation: "window_lapsed",
      costAllocated: true,
    };
    expect(transitionTicket(state, close, context).ok).toBe(true);
    expectCode(
      transitionTicket(state, close, {
        ...context,
        now: utcInstant.parse("2026-09-30T09:59:59.999999Z"),
      }),
      "CONFIRMATION_REQUIRED",
    );
    expectCode(
      transitionTicket(state, close, {
        ...context,
        now: utcInstant.parse("2026-09-30T10:00:00.000001Z"),
        confirmationDeadline: utcInstant.parse("2026-09-30T10:00:00.000002Z"),
      }),
      "CONFIRMATION_REQUIRED",
    );
    expectCode(
      transitionTicket(state, close, contextFor("close")),
      "NOT_AUTHORISED",
    );
    expectCode(
      transitionTicket(state, commands.close, {
        ...contextFor("close"),
        actor: { ...tenantActor, accountId: owner, sessionAccountId: owner },
      }),
      "NOT_AUTHORISED",
    );
  });
  it("AC-9 random ticket command sequences never throw and follow table rows", () => {
    fc.assert(
      fc.property(
        fc.option(fc.constantFrom(...ticketStatus.options), { nil: null }),
        fc.array(fc.constantFrom(...Object.values(commands)), {
          maxLength: 100,
        }),
        (initial, sequence) => {
          let state: TicketSnapshot | null =
            initial === null ? null : { ...snapshot, status: initial };
          for (const command of sequence) {
            const before = state?.status ?? null;
            const result = transitionTicket(
              state,
              command,
              contextFor(command.type),
            );
            if (result.ok) {
              expect(
                ticketTransitions.some(
                  (row) =>
                    row.from === before &&
                    row.command === command.type &&
                    row.to === result.value.ticket.status,
                ),
              ).toBe(true);
              state = result.value.ticket;
            } else
              expect(
                maintenanceErrorCode.safeParse(result.error.code).success,
              ).toBe(true);
          }
        },
      ),
      { seed: 2060928, numRuns: 100 },
    );
  }, 60_000);
});

describe("cost authority", () => {
  const cases: readonly {
    readonly name: string;
    readonly patch: Partial<CostApprovalInput>;
    readonly route: string;
  }[] = [
    {
      name: "unset threshold",
      patch: { costThresholdFils: null, safetyCritical: true },
      route: "owner",
    },
    { name: "equal threshold", patch: {}, route: "manager" },
    {
      name: "one fils above",
      patch: { costFils: fils.parse(101) },
      route: "owner",
    },
    {
      name: "emergency contact recorded",
      patch: { costFils: fils.parse(101), safetyCritical: true },
      route: "emergency_rule",
    },
    {
      name: "zero attempts",
      patch: {
        costFils: fils.parse(101),
        safetyCritical: true,
        ownerContactAttempts: 0,
      },
      route: "owner",
    },
    {
      name: "reachable owner",
      patch: {
        costFils: fils.parse(101),
        safetyCritical: true,
        ownerReachable: true,
      },
      route: "owner",
    },
    {
      name: "above emergency limit",
      patch: { costFils: fils.parse(201), safetyCritical: true },
      route: "owner",
    },
    {
      name: "equal emergency limit",
      patch: { costFils: fils.parse(200), safetyCritical: true },
      route: "emergency_rule",
    },
    {
      name: "no emergency limit",
      patch: {
        costFils: fils.parse(201),
        safetyCritical: true,
        emergencyLimitFils: null,
      },
      route: "emergency_rule",
    },
    {
      name: "fractional attempt",
      patch: {
        costFils: fils.parse(101),
        safetyCritical: true,
        ownerContactAttempts: 1.5,
      },
      route: "owner",
    },
  ];
  it.each(cases)("AC-2 cost route: $name", ({ patch, route }) => {
    const result = costApprovalRoute({
      ...context.cost,
      safetyCritical: false,
      ...patch,
    });
    expect(result.route).toBe(route);
    if (route === "emergency_rule")
      expect(result).toEqual({
        route,
        notify_owner: true,
        charge_owner_afterwards: true,
      });
  });
  it("AC-2 refuses dispatch above the limit without approval", () => {
    const state = { ...snapshot, status: "triaged" } as const;
    const input = {
      ...context,
      cost: { ...context.cost, costFils: fils.parse(101) },
    };
    expectCode(
      transitionTicket(state, commands.schedule, input),
      "COST_APPROVAL_REQUIRED",
    );
    const approval = {
      accountId: owner,
      sessionAccountId: owner,
      costFils: fils.parse(101),
    };
    expect(
      transitionTicket(state, commands.schedule, {
        ...input,
        ownerApproval: approval,
      }).ok,
    ).toBe(true);
    for (const ownerApproval of [
      { ...approval, accountId: tenant },
      { ...approval, sessionAccountId: tenant },
      { ...approval, costFils: fils.parse(100) },
    ]) {
      expectCode(
        transitionTicket(state, commands.schedule, { ...input, ownerApproval }),
        "COST_APPROVAL_REQUIRED",
      );
    }
    expect(
      transitionTicket(
        { ...state, safetyFlags: ["gas_smell"] },
        commands.schedule,
        input,
      ),
    ).toMatchObject({
      ok: true,
      value: { notify_owner: true, charge_owner_afterwards: true },
    });
    expectCode(
      transitionTicket(
        { ...state, status: "awaiting_quote" },
        commands.schedule,
        input,
      ),
      "COST_APPROVAL_REQUIRED",
    );
  });
  it.each([-1, 0.5, Infinity, NaN])(
    "refuses invalid owner contact attempts %s",
    (ownerContactAttempts) => {
      expectCode(
        transitionTicket(
          { ...snapshot, status: "triaged" },
          commands.schedule,
          { ...context, cost: { ...context.cost, ownerContactAttempts } },
        ),
        "INVALID_INPUT",
      );
    },
  );
  it.each(["costFils", "costThresholdFils", "emergencyLimitFils"] as const)(
    "refuses negative %s",
    (field) => {
      expectCode(
        transitionTicket(
          { ...snapshot, status: "triaged" },
          commands.schedule,
          { ...context, cost: { ...context.cost, [field]: fils.parse(-1) } },
        ),
        "INVALID_INPUT",
      );
    },
  );
  it("refuses unnecessary owner-cost routing within the limit", () => {
    expectCode(
      transitionTicket(
        { ...snapshot, status: "triaged" },
        commands.request_cost_approval,
        context,
      ),
      "INVALID_INPUT",
    );
  });
});

describe("resolution deadlines and ratings", () => {
  it.each([
    ["emergency", "2026-09-28T19:30:00Z", "2026-09-28T19:59:59.999999Z"],
    ["emergency", "2026-09-28T20:00:00Z", "2026-09-29T19:59:59.999999Z"],
    ["urgent", "2026-09-28T19:30:00Z", "2026-09-30T19:30:00Z"],
    ["routine", "2026-09-28T19:30:00Z", "2026-10-05T19:30:00Z"],
    ["urgent", "2026-09-28T19:30:00.123456Z", "2026-09-30T19:30:00.123456Z"],
    ["routine", "2028-02-25T19:30:00.1Z", "2028-03-03T19:30:00.1Z"],
  ] as const)("AC-3 %s deadline from %s", (priority, reportedAt, expected) => {
    expect(resolutionDeadline(priority, utcInstant.parse(reportedAt))).toBe(
      expected,
    );
  });
  it("rejects deadline calendar overflow", () => {
    expect(() =>
      resolutionDeadline("routine", utcInstant.parse("9999-12-31T00:00:00Z")),
    ).toThrow(RangeError);
  });
  it.each([0, 6, 1.5, NaN, Infinity])(
    "AC-4 refuses invalid score %s",
    (score) => {
      expectCode(
        rateTicket(
          { ...snapshot, status: "work_completed" },
          score,
          tenantActor,
        ),
        "INVALID_INPUT",
      );
    },
  );
  it.each([1, 2, 3, 4, 5])(
    "records score %s only once after completion",
    (score) => {
      for (const status of ["work_completed", "closed"] as const) {
        const result = rateTicket({ ...snapshot, status }, score, tenantActor);
        expect(result).toMatchObject({ ok: true, value: { rating: score } });
        if (result.ok)
          expectCode(
            rateTicket(result.value, score, tenantActor),
            "RATING_EXISTS",
          );
      }
    },
  );
  it("AC-4 refuses premature ratings and binds ratings to the reporting tenant", () => {
    expectCode(rateTicket(snapshot, 5, tenantActor), "INVALID_TRANSITION");
    const state = { ...snapshot, status: "closed" } as const;
    expectCode(rateTicket(state, 5, manager), "NOT_AUTHORISED");
    expectCode(
      rateTicket({ ...state, authorRole: "owner" }, 5, tenantActor),
      "NOT_AUTHORISED",
    );
    expectCode(
      rateTicket(state, 5, { ...tenantActor, accountId: owner }),
      "NOT_AUTHORISED",
    );
    expectCode(
      rateTicket(state, 5, { ...tenantActor, sessionAccountId: owner }),
      "NOT_OWN_SESSION",
    );
  });
});

describe("manager-recorded vendor updates", () => {
  function dispatchCommand(type: DispatchCommand["type"]): DispatchCommand {
    return type === "decline" || type === "cancel"
      ? { type, reason: "Vendor unavailable" }
      : { type };
  }
  function quoteCommand(type: QuoteCommand["type"]): QuoteCommand {
    switch (type) {
      case "receive":
        return { type, amount_fils: fils.parse(100) };
      case "approve":
        return { type };
      case "reject":
        return { type, reason: "Quote declined" };
    }
  }
  it.each(dispatchTransitions)("dispatch $from / $command / $to", (row) => {
    expect(
      transitionDispatch(row.from, dispatchCommand(row.command), manager),
    ).toMatchObject({ ok: true, value: { status: row.to } });
    expectCode(
      transitionDispatch("done", dispatchCommand(row.command), manager),
      "INVALID_TRANSITION",
    );
  });
  it.each(["decline", "cancel"] as const)(
    "requires a dispatch %s reason",
    (type) => {
      expectCode(
        transitionDispatch("assigned", { type, reason: null }, manager),
        "REASON_REQUIRED",
      );
    },
  );
  it.each(quoteTransitions)("quote $from / $command / $to", (row) => {
    expect(
      transitionQuote(
        { status: row.from, amount_fils: fils.parse(100) },
        quoteCommand(row.command),
        manager,
      ),
    ).toMatchObject({
      ok: true,
      value: { quote: { status: row.to, amount_fils: 100 } },
    });
    expectCode(
      transitionQuote(
        { status: "approved", amount_fils: fils.parse(100) },
        quoteCommand(row.command),
        manager,
      ),
      "INVALID_TRANSITION",
    );
  });
  it.each([0, -1])("refuses a nonpositive quote of %s", (amount) => {
    expectCode(
      transitionQuote(
        { status: "requested", amount_fils: null },
        { type: "receive", amount_fils: fils.parse(amount) },
        manager,
      ),
      "INVALID_INPUT",
    );
  });
  it("requires a quote rejection reason", () => {
    expectCode(
      transitionQuote(
        { status: "received", amount_fils: fils.parse(100) },
        { type: "reject", reason: null },
        manager,
      ),
      "REASON_REQUIRED",
    );
  });
  it.each([tenantActor, { ...manager, sessionAccountId: tenant }])(
    "refuses vendor updates without a manager's own session",
    (actor) => {
      const code =
        actor.role === "tenant" ? "NOT_AUTHORISED" : "NOT_OWN_SESSION";
      expectCode(
        transitionDispatch("assigned", { type: "accept" }, actor),
        code,
      );
      expectCode(
        transitionQuote(
          { status: "received", amount_fils: fils.parse(100) },
          { type: "approve" },
          actor,
        ),
        code,
      );
    },
  );
});
