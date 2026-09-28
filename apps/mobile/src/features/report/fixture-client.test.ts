import { createFixtureReportClient } from "./fixture-client";
import { syntheticId, syntheticMedia } from "./test-support";
import { intakeViewSchema, ticketViewSchema } from "./contract";
it("keeps the synthetic journey usable with no network and creates a ticket only on confirmation", async () => {
  const network = jest
    .spyOn(global, "fetch")
    .mockRejectedValue(new Error("Network forbidden in fixture"));
  const client = createFixtureReportClient();
  const company = syntheticId(80);
  const [unit] = await client.units(company);
  expect(unit?.label).toContain("Synthetic");
  const sample = syntheticMedia();
  const upload = await client.createUpload(
    company,
    {
      unitId: sample.unitId,
      kind: sample.kind,
      contentType: sample.contentType,
      byteSize: sample.byteSize,
      sha256: sample.sha256,
      durationMs: 12000,
    },
    "upload-command",
  );
  await client.putObject(upload.upload, new Uint8Array([97, 98, 99]));
  const media = await client.completeUpload(
    company,
    upload.media.id,
    { expectedVersion: 1 },
    "complete-command",
  );
  const input = {
    unitId: sample.unitId,
    language: "ar" as const,
    voiceMediaId: media.id,
    photoMediaIds: [],
    typedText: null,
  };
  const intake = await client.createIntake(company, input, "intake-command");
  expect(intakeViewSchema.safeParse(intake).success).toBe(true);
  expect(intake.ticketId).toBeNull();
  expect(intake.transcript).toContain("تجريبي");
  expect(await client.createIntake(company, input, "intake-command")).toEqual(
    intake,
  );
  await expect(
    client.getIntake(syntheticId(81), intake.id),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const body = {
    expectedVersion: intake.version,
    transcript: intake.transcript,
    category: intake.category,
    priority: intake.priority,
    safetyFlags: intake.safetyFlags,
    description: intake.description,
  };
  expect(await client.tickets(company)).toEqual({
    items: [],
    nextCursor: null,
  });
  const result = await client.confirmIntake(
    company,
    intake.id,
    body,
    "confirm-command",
  );
  expect(ticketViewSchema.safeParse(result.ticket).success).toBe(true);
  expect(result.ticket.status).toBe("reported");
  expect((await client.tickets(company)).items).toEqual([result.ticket]);
  expect(await client.ticket(company, result.ticket.id)).toEqual(result.ticket);
  expect(await client.tickets(syntheticId(81))).toEqual({
    items: [],
    nextCursor: null,
  });
  await expect(
    client.ticket(syntheticId(81), result.ticket.id),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(client.mediaLink(company, media.id)).rejects.toMatchObject({
    code: "UPLOAD_NOT_READY",
  });
  expect(
    await client.confirmIntake(company, intake.id, body, "confirm-command"),
  ).toEqual(result);
  await expect(
    client.confirmIntake(
      company,
      intake.id,
      { ...body, description: "changed" },
      "confirm-command",
    ),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  await expect(
    client.rejectIntake(
      company,
      intake.id,
      { expectedVersion: 2, reason: null },
      "reject-command",
    ),
  ).rejects.toMatchObject({ code: "ALREADY_DECIDED" });
  expect(network).not.toHaveBeenCalled();
  network.mockRestore();
});
it("rejects a synthetic draft without issuing a ticket and enforces its version", async () => {
  const client = createFixtureReportClient();
  const company = syntheticId(80);
  const intake = await client.createIntake(
    company,
    {
      unitId: syntheticId(1),
      language: "en",
      voiceMediaId: null,
      photoMediaIds: [],
      typedText: "Synthetic leak",
    },
    "create",
  );
  await expect(
    client.rejectIntake(
      company,
      intake.id,
      { expectedVersion: 8, reason: null },
      "reject",
    ),
  ).rejects.toMatchObject({ code: "STALE_VERSION" });
  const rejected = await client.rejectIntake(
    company,
    intake.id,
    { expectedVersion: 1, reason: null },
    "reject",
  );
  expect(rejected.status).toBe("rejected");
  expect(rejected.ticketId).toBeNull();
});
