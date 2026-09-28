import { createHttpReportClient } from "./http-client";
import { reportErrorCodeSchema } from "./client";
import {
  syntheticId,
  syntheticIntake,
  syntheticMedia,
  syntheticTicket,
  syntheticUpload,
  jsonResponse,
} from "./test-support";
const base = "https://api.example.test";
const company = syntheticId(80);
function fake(): jest.Mock<ReturnType<typeof fetch>, Parameters<typeof fetch>> {
  return jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
}
it("AC-1 sends every API route with the active company, validated views and command headers", async () => {
  const intake = syntheticIntake();
  const upload = syntheticUpload();
  const units = [
    {
      id: syntheticId(1),
      unitNo: "104",
      propertyName: "Synthetic",
      label: "Synthetic 104",
    },
  ];
  const auth = fake()
    .mockResolvedValueOnce(jsonResponse({ items: units }))
    .mockResolvedValueOnce(jsonResponse(upload, 201))
    .mockResolvedValueOnce(jsonResponse({ media: syntheticMedia() }))
    .mockResolvedValueOnce(jsonResponse({ intake }, 201))
    .mockResolvedValueOnce(jsonResponse({ intake }))
    .mockResolvedValueOnce(
      jsonResponse(
        {
          intake: { ...intake, status: "committed" },
          ticket: syntheticTicket(),
        },
        201,
      ),
    )
    .mockResolvedValueOnce(
      jsonResponse({ intake: { ...intake, status: "rejected" } }),
    );
  const plain = fake().mockResolvedValue(new Response(null, { status: 200 }));
  const client = createHttpReportClient(`${base}/`, auth, plain);
  expect(await client.units(company)).toEqual(units);
  expect(
    await client.createUpload(
      company,
      {
        unitId: upload.media.unitId,
        kind: "voice_note",
        contentType: "audio/mp4",
        byteSize: 3,
        sha256: upload.media.sha256,
        durationMs: 12000,
      },
      "create-key",
    ),
  ).toEqual(upload);
  await client.putObject(upload.upload, new Uint8Array([97, 98, 99]));
  expect(
    await client.completeUpload(
      company,
      upload.media.id,
      { expectedVersion: 1 },
      "complete-key",
    ),
  ).toEqual(syntheticMedia());
  expect(
    await client.createIntake(
      company,
      {
        unitId: intake.unitId,
        language: "ar",
        voiceMediaId: upload.media.id,
        photoMediaIds: [],
        typedText: null,
      },
      "intake-key",
    ),
  ).toEqual(intake);
  expect(await client.getIntake(company, intake.id)).toEqual(intake);
  await client.confirmIntake(
    company,
    intake.id,
    {
      expectedVersion: 1,
      transcript: intake.transcript,
      category: "plumbing",
      priority: "urgent",
      safetyFlags: [],
      description: intake.description,
    },
    "confirm-key",
  );
  await client.rejectIntake(
    company,
    intake.id,
    { expectedVersion: 1, reason: null },
    "reject-key",
  );
  expect(auth.mock.calls.map(([url]) => url)).toEqual(
    [
      "/maintenance/units",
      "/media/uploads",
      `/media/${upload.media.id}/complete`,
      "/maintenance/intakes",
      `/maintenance/intakes/${intake.id}`,
      `/maintenance/intakes/${intake.id}/confirm`,
      `/maintenance/intakes/${intake.id}/reject`,
    ].map((path) => `${base}/v1/companies/${company}${path}`),
  );
  const posts = auth.mock.calls.filter(([, init]) => init?.method === "POST");
  expect(
    posts.map(([, init]) => new Headers(init?.headers).get("Idempotency-Key")),
  ).toEqual([
    "create-key",
    "complete-key",
    "intake-key",
    "confirm-key",
    "reject-key",
  ]);
  for (const [, init] of posts)
    expect(new Headers(init?.headers).get("Content-Type")).toBe(
      "application/json",
    );
  expect(plain).toHaveBeenCalledTimes(1);
});
it.each(
  reportErrorCodeSchema.options.filter((code) => code === code.toUpperCase()),
)("AC-1 maps problem code %s", async (code) => {
  const client = createHttpReportClient(
    base,
    fake().mockResolvedValue(jsonResponse({ code }, 409)),
  );
  await expect(client.getIntake(company, syntheticId(4))).rejects.toMatchObject(
    { code },
  );
});
it.each([403, 404])(
  "AC-1 maps bare HTTP %s without leaking a response body",
  async (status) => {
    const client = createHttpReportClient(
      base,
      fake().mockResolvedValue(new Response("unavailable", { status })),
    );
    await expect(client.units(company)).rejects.toMatchObject({
      code: status === 403 ? "NOT_AUTHORISED" : "NOT_FOUND",
    });
  },
);
it.each([
  { intake: {} },
  { intake: { ...syntheticIntake(), priority: "unknown" } },
  {},
])("AC-1 rejects malformed response %j", async (body) => {
  const client = createHttpReportClient(
    base,
    fake().mockResolvedValue(jsonResponse(body)),
  );
  await expect(client.getIntake(company, syntheticId(4))).rejects.toMatchObject(
    { code: "unexpected_response" },
  );
});
it("AC-1 treats malformed JSON as unexpected_response and unknown problem codes as could_not_load", async () => {
  const auth = fake()
    .mockResolvedValueOnce(new Response("invalid", { status: 200 }))
    .mockResolvedValueOnce(jsonResponse({ code: "INTERNAL_FAILURE" }, 500));
  const client = createHttpReportClient(base, auth);
  await expect(client.units(company)).rejects.toMatchObject({
    code: "unexpected_response",
  });
  await expect(client.units(company)).rejects.toMatchObject({
    code: "could_not_load",
  });
});
it("AC-1 times out an unresolved request and retains the caller's command key", async () => {
  jest.useFakeTimers();
  const auth = fake().mockImplementation(() => new Promise(() => undefined));
  const client = createHttpReportClient(base, auth);
  const result = expect(
    client.rejectIntake(
      company,
      syntheticId(4),
      { expectedVersion: 1, reason: null },
      "retained-command",
    ),
  ).rejects.toMatchObject({ code: "network_unavailable" });
  await jest.advanceTimersByTimeAsync(30_000);
  await result;
  expect(auth.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  jest.useRealTimers();
});

it("reads ticket pages, detail and media links through the authorised adapter", async () => {
  const ticket = syntheticTicket();
  const page = { items: [ticket], nextCursor: "next+/=" };
  const link = {
    url: "https://objects.example.test/photo?signature=synthetic",
    expiresAt: "2099-09-28T06:15:00Z",
  };
  const auth = fake()
    .mockResolvedValueOnce(jsonResponse(page))
    .mockResolvedValueOnce(jsonResponse({ ticket }))
    .mockResolvedValueOnce(jsonResponse(link));
  const plain = fake();
  const client = createHttpReportClient(base, auth, plain);
  expect((await client.tickets(company, "next+/=")).items[0]?.id).toBe(
    ticket.id,
  );
  expect(await client.ticket(company, ticket.id)).toEqual(ticket);
  expect(await client.mediaLink(company, syntheticId(3))).toEqual(link);
  expect(auth.mock.calls.map(([url]) => url)).toEqual([
    `${base}/v1/companies/${company}/maintenance/tickets?limit=20&cursor=next%2B%2F%3D`,
    `${base}/v1/companies/${company}/maintenance/tickets/${ticket.id}`,
    `${base}/v1/companies/${company}/media/${syntheticId(3)}/download`,
  ]);
  expect(plain).not.toHaveBeenCalled();
  for (const [, init] of auth.mock.calls) expect(init?.method).toBe("GET");
});
