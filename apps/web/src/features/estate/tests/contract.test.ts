import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ownerListSchema,
  ownerDetailSchema,
  propertyListSchema,
  propertyDetailSchema,
  processingStatusSchema,
} from "../contract";
import owners from "./fixtures/owners-list.synthetic.json";
import owner from "./fixtures/owner-detail.synthetic.json";
import properties from "./fixtures/properties-list.synthetic.json";
import property from "./fixtures/property-detail.synthetic.json";

describe("AC-0 recorded synthetic API contract", () => {
  it.each<[string, z.ZodType, unknown]>([
    ["owners-list", ownerListSchema, owners],
    ["owner-detail", ownerDetailSchema, owner],
    ["properties-list", propertyListSchema, properties],
    ["property-detail", propertyDetailSchema, property],
  ])("parses %s and identifies the first mismatch", (name, schema, data) => {
    const result = schema.safeParse(data);
    if (!result.success) {
      const first = result.error.issues[0];
      throw new Error(
        `${name}: ${first?.path.join(".") ?? "root"}: ${first?.message ?? "Mismatch"}`,
      );
    }
    expect(result.success).toBe(true);
  });

  it("preserves the checksum rejection category", () => {
    const copy = structuredClone(property);
    const version = copy.documents[0]?.latest;
    if (!version) throw new Error("Missing synthetic document version");
    Object.assign(version, {
      processingStatus: "scan_rejected",
      scanResult: "checksum_mismatch",
    });
    expect(propertyDetailSchema.parse(copy).documents[0]?.latest).toMatchObject(
      {
        processingStatus: "scan_rejected",
        scanResult: "checksum_mismatch",
      },
    );
  });

  it("accepts stored processing states and rejects invented states", () => {
    for (const state of [
      "awaiting_upload",
      "uploaded",
      "scan_clean",
      "scan_rejected",
      "extracting",
      "extracted",
      "extraction_failed",
    ])
      expect(processingStatusSchema.safeParse(state).success).toBe(true);
    for (const state of [
      "pending_upload",
      "scan_pending",
      "scan_infected",
      "scan_failed",
    ])
      expect(processingStatusSchema.safeParse(state).success).toBe(false);
  });

  it("accepts nullable history, mandate, bank and property values", () => {
    const parsed = ownerDetailSchema.parse(owner);
    expect(
      ownerDetailSchema.safeParse({
        ...parsed,
        bank: { bankName: null, accountHolder: null, ibanLast4: null },
        mandate: parsed.mandate
          ? { ...parsed.mandate, costThresholdFils: null }
          : null,
        history: [
          {
            eventType: "record.updated",
            occurredAt: "2026-09-28T00:00:00.000Z",
            actorDisplayName: null,
            actorRole: null,
            channel: "system",
            reason: null,
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      propertyDetailSchema.safeParse({ ...property, use: null }).success,
    ).toBe(true);
  });
});
