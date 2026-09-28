import { describe, expect, it } from "vitest";
import { propertyId } from "../ids";
import { localDate } from "../time";
import {
  ownerGate,
  type OwnerGateCompany,
  type OwnerGateMandate,
} from "./index";

const property = propertyId.parse("00000000-0000-4000-8000-000000000001");
const on = localDate.parse("2026-09-28");
const mandate: OwnerGateMandate = {
  status: "active",
  propertyIds: [property],
  startsOn: localDate.parse("2026-01-01"),
  endsOn: localDate.parse("2026-12-31"),
  ownerGate: false,
};

describe("R9 owner gate", () => {
  it.each([
    ["self_managed_owner", true, true, false],
    ["self_managed_owner", true, false, false],
    ["self_managed_owner", true, null, false],
    ["self_managed_owner", false, true, false],
    ["self_managed_owner", false, null, false],
    ["self_managed_owner", null, true, false],
    ["self_managed_owner", null, false, false],
    ["self_managed_owner", false, false, false],
    ["self_managed_owner", null, null, false],
    ["management_company", true, false, true],
    ["management_company", false, true, false],
    ["management_company", null, true, true],
    ["management_company", null, false, false],
    ["management_company", null, null, true],
  ] as const)(
    "AC-3 precedence: %s override %s mandate %s gives %s",
    (kind, override, choice, expected) => {
      expect(
        ownerGate(
          { kind, defaultOwnerGate: true },
          { id: property, ownerGateOverride: override },
          { ...mandate, ownerGate: choice },
          on,
        ),
      ).toBe(expected);
    },
  );

  it.each([
    null,
    { ...mandate, status: "expired" },
    { ...mandate, status: "ended" },
    { ...mandate, startsOn: localDate.parse("2026-09-29") },
    { ...mandate, endsOn: localDate.parse("2026-09-27") },
    { ...mandate, propertyIds: [] },
  ] satisfies readonly (OwnerGateMandate | null)[])(
    "AC-3 absent, expired or unrelated mandate uses the company default: %j",
    (value) => {
      expect(
        ownerGate(
          { kind: "management_company", defaultOwnerGate: true },
          { id: property, ownerGateOverride: null },
          value,
          on,
        ),
      ).toBe(true);
    },
  );

  it.each(["2026-01-01", "2026-12-31"])(
    "includes the mandate boundary %s",
    (date) => {
      expect(
        ownerGate(
          { kind: "management_company", defaultOwnerGate: true },
          { id: property, ownerGateOverride: null },
          mandate,
          localDate.parse(date),
        ),
      ).toBe(false);
    },
  );

  it("AC-3 permits an active open-ended mandate", () => {
    expect(
      ownerGate(
        { kind: "management_company", defaultOwnerGate: true },
        { id: property, ownerGateOverride: null },
        { ...mandate, endsOn: null },
        on,
      ),
    ).toBe(false);
  });

  it("honours a configured company default off", () => {
    const company: OwnerGateCompany = {
      kind: "management_company",
      defaultOwnerGate: false,
    };
    expect(
      ownerGate(company, { id: property, ownerGateOverride: null }, null, on),
    ).toBe(false);
  });
});
