import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  confirmIntakeBodySchema,
  intakeBodySchema,
  rejectIntakeBodySchema,
  uploadBodySchema,
} from "./contract";

it("exports upload limits for the mobile adapter", () => {
  const photo = {
    unitId: randomUUID(),
    kind: "photo",
    contentType: "image/png",
    byteSize: 20 * 1024 * 1024,
    sha256: "ab".repeat(32),
  };
  expect(uploadBodySchema.safeParse(photo).success).toBe(true);
  expect(
    uploadBodySchema.safeParse({ ...photo, byteSize: photo.byteSize + 1 })
      .success,
  ).toBe(false);
  expect(uploadBodySchema.safeParse({ ...photo, durationMs: 0 }).success).toBe(
    false,
  );
});
it("exports bounded intake, confirmation and rejection bodies", () => {
  const intake = {
    unitId: randomUUID(),
    language: "ar",
    voiceMediaId: null,
    photoMediaIds: [],
    typedText: "synthetic",
  };
  expect(intakeBodySchema.safeParse(intake).success).toBe(true);
  expect(
    intakeBodySchema.safeParse({ ...intake, typedText: "x".repeat(2001) })
      .success,
  ).toBe(false);
  expect(
    intakeBodySchema.safeParse({
      ...intake,
      photoMediaIds: Array.from({ length: 4 }, () => randomUUID()),
    }).success,
  ).toBe(false);
  const confirm = {
    expectedVersion: 1,
    transcript: null,
    category: "plumbing",
    priority: "routine",
    safetyFlags: [],
    description: "Synthetic leak",
  };
  expect(confirmIntakeBodySchema.safeParse(confirm).success).toBe(true);
  expect(
    confirmIntakeBodySchema.safeParse({ ...confirm, payer: "tenant" }).success,
  ).toBe(false);
  expect(
    rejectIntakeBodySchema.safeParse({
      expectedVersion: 1,
      reason: "x".repeat(501),
    }).success,
  ).toBe(false);
  expect(
    confirmIntakeBodySchema.safeParse({
      ...confirm,
      transcript: "x".repeat(8001),
    }).success,
  ).toBe(false);
  expect(
    confirmIntakeBodySchema.safeParse({ ...confirm, safetyFlags: ["unknown"] })
      .success,
  ).toBe(false);
  expect(
    confirmIntakeBodySchema.safeParse({ ...confirm, description: "" }).success,
  ).toBe(false);
  expect(
    rejectIntakeBodySchema.safeParse({ expectedVersion: 1, reason: null })
      .success,
  ).toBe(true);
});
