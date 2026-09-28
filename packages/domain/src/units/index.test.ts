import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { localDate } from "../time";
import { unitStatus, type UnitStatus } from "../vocabulary";
import {
  checkUnitContractDraft,
  isOccupied,
  transitionUnit,
  unitTransitions,
  unitsErrorCode,
  type UnitCommand,
} from "./index";

function command(type: UnitCommand["type"]): UnitCommand {
  return type === "block" ? { type, reason: "owner_use" } : { type };
}

describe("unit lifecycle", () => {
  it.each(unitTransitions)("AC-5 allows $from / $command / $to", (row) => {
    expect(transitionUnit(row.from, command(row.command))).toEqual({
      ok: true,
      value: row.to,
    });
  });
  it.each(unitTransitions)(
    "AC-5 refuses $command from a wrong state",
    (row) => {
      const wrong = unitStatus.options.find(
        (status) =>
          !unitTransitions.some(
            (entry) => entry.from === status && entry.command === row.command,
          ),
      );
      expect(wrong).toBeDefined();
      if (wrong === undefined) throw new Error("Missing wrong-state fixture");
      expect(transitionUnit(wrong, command(row.command))).toEqual({
        ok: false,
        error: { code: "INVALID_TRANSITION" },
      });
    },
  );
  it("AC-5 refuses blocking without a reason", () => {
    expect(transitionUnit("vacant", { type: "block", reason: null })).toEqual({
      ok: false,
      error: { code: "REASON_REQUIRED", field: "reason" },
    });
  });
  it.each(["owner_use", "legal_hold", "sale"] as const)(
    "allows blocking for %s",
    (reason) => {
      expect(transitionUnit("vacant", { type: "block", reason }).ok).toBe(true);
    },
  );
  it.each(unitStatus.options)("guards new drafts on a %s unit", (status) => {
    expect(checkUnitContractDraft(status)).toEqual(
      status === "blocked"
        ? { ok: false, error: { code: "UNIT_BLOCKED" } }
        : { ok: true, value: undefined },
    );
  });
  const facts = [false, true].flatMap((concludedContract) =>
    [false, true].flatMap((moveIn) =>
      [false, true].map((moveOut) => ({ concludedContract, moveIn, moveOut })),
    ),
  );
  it.each(facts)(
    "AC-5 occupancy truth table: $concludedContract / $moveIn / $moveOut",
    (fact) => {
      const date = localDate.parse("2026-09-28");
      expect(
        isOccupied({
          concludedContract: fact.concludedContract,
          moveIn: fact.moveIn ? date : null,
          moveOut: fact.moveOut ? date : null,
        }),
      ).toBe(fact.concludedContract && fact.moveIn && !fact.moveOut);
    },
  );
  it("AC-9 random unit command sequences never throw and follow table rows", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...unitStatus.options),
        fc.array(
          fc.constantFrom(
            ...unitTransitions.map((row) => command(row.command)),
          ),
          { maxLength: 100 },
        ),
        (initial, commands) => {
          let state: UnitStatus = initial;
          for (const entry of commands) {
            const result = transitionUnit(state, entry);
            if (result.ok) {
              expect(
                unitTransitions.some(
                  (row) =>
                    row.from === state &&
                    row.command === entry.type &&
                    row.to === result.value,
                ),
              ).toBe(true);
              state = result.value;
            } else
              expect(unitsErrorCode.safeParse(result.error.code).success).toBe(
                true,
              );
          }
        },
      ),
      { seed: 2060928, numRuns: 100 },
    );
  }, 60_000);
});
