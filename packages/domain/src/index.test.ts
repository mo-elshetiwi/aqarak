import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as publicDomain from "@aqarak/domain";
import {
  encodeCanonical,
  verifyChain,
  transitionContract,
  validateContractSchedule,
  deriveDocumentValidity,
  transitionDocumentReview,
  decideIdempotency,
  firingDedupeKey,
  transitionMembership,
  transitionDraftedAction,
  transitionTicket,
  costApprovalRoute,
  ownerGate,
  allocate,
  deriveChargeStatus,
  can,
  coWorkerToolFamilies,
  transitionTawtheeq,
  resolveDiscrepancy,
  transitionUnit,
  isOccupied,
  fils,
  localDate,
  companyId,
  role,
  ok,
  requireReason,
  tenantRecord,
  contractRecord,
} from "./index";

describe("public package entry", () => {
  it.each(Object.entries({ tenantRecord, contractRecord }))(
    "exports %s as a Zod schema through both the entry and package name",
    (name, schema) => {
      expect(schema).toBeInstanceOf(z.ZodType);
      expect(Reflect.get(publicDomain, name)).toBe(schema);
    },
  );

  it.each(
    Object.entries({
      encodeCanonical,
      verifyChain,
      transitionContract,
      validateContractSchedule,
      deriveDocumentValidity,
      transitionDocumentReview,
      decideIdempotency,
      firingDedupeKey,
      transitionMembership,
      transitionDraftedAction,
      transitionTicket,
      costApprovalRoute,
      ownerGate,
      allocate,
      deriveChargeStatus,
      can,
      coWorkerToolFamilies,
      transitionTawtheeq,
      resolveDiscrepancy,
      transitionUnit,
      isOccupied,
      ok,
      requireReason,
    }),
  )("exports %s through both the entry and package name", (name, symbol) => {
    expect(symbol).toBeTypeOf("function");
    expect(Reflect.get(publicDomain, name)).toBe(symbol);
  });

  it("retains shared schemas alongside every folder", () => {
    expect(fils.parse(100)).toBe(100);
    expect(localDate.parse("2026-09-28")).toBe("2026-09-28");
    expect(
      companyId.safeParse("00000000-0000-4000-8000-000000000001").success,
    ).toBe(true);
    expect(role.parse("owner")).toBe("owner");
    expect(
      deriveDocumentValidity({
        expiryDate: null,
        leadDays: 0,
        on: localDate.parse("2026-09-28"),
      }),
    ).toBe("valid");
  });
});
