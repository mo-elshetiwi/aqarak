import type {
  ConfirmIntakeBody,
  IntakeView,
  MediaView,
  TicketView,
  UploadResponse,
} from "./contract";
/** I use deterministic synthetic identifiers only in offline contract tests. */
export function syntheticId(value: number): string {
  return `40000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}
/** I construct a synthetic view with the SHA-256 of the bytes abc. */
export function syntheticMedia(
  kind: "voice_note" | "photo" = "voice_note",
): MediaView {
  return {
    id: syntheticId(kind === "voice_note" ? 2 : 3),
    unitId: syntheticId(1),
    kind,
    contentType: kind === "photo" ? "image/jpeg" : "audio/mp4",
    byteSize: 3,
    sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    durationMs: kind === "voice_note" ? 12000 : null,
    status: "scan_clean",
    version: 2,
    createdAt: "2026-09-28T06:00:00Z",
  };
}
/** I keep test drafts independent of model providers and network services. */
export function syntheticIntake(
  overrides: Partial<IntakeView> = {},
): IntakeView {
  return {
    id: syntheticId(4),
    unitId: syntheticId(1),
    version: 1,
    status: "ready",
    language: "ar",
    transcript: "يوجد تسرب ماء تحت الحوض",
    typedText: null,
    category: "plumbing",
    priority: "urgent",
    safetyFlags: [],
    description: "يوجد تسرب ماء تحت الحوض",
    payer: "owner",
    transcription: { mode: "model" },
    triage: { mode: "model", confidence: 0.9 },
    media: [syntheticMedia(), syntheticMedia("photo")],
    ticketId: null,
    createdAt: "2026-09-28T06:00:00Z",
    ...overrides,
  };
}
/** I preserve edited confirmation fields in the synthetic server result. */
export function syntheticTicket(body?: ConfirmIntakeBody): TicketView {
  const intake = syntheticIntake();
  return {
    id: syntheticId(5),
    unitId: intake.unitId,
    unitLabel: "Synthetic unit 104",
    version: 1,
    category: intake.category,
    priority: intake.priority,
    status: "reported",
    safetyCritical: false,
    createdAt: intake.createdAt,
    reportedByMe: true,
    description: intake.description,
    transcript: intake.transcript,
    safetyFlags: [],
    payer: "owner",
    channel: "voice",
    intakeId: intake.id,
    media: intake.media,
    ...body,
  };
}
/** I keep presigned object requests on a reserved synthetic host. */
export function syntheticUpload(
  kind: "voice_note" | "photo" = "voice_note",
): UploadResponse {
  return {
    media: { ...syntheticMedia(kind), status: "awaiting_upload", version: 1 },
    upload: {
      method: "PUT",
      url: `https://objects.example.test/${kind}`,
      headers: {
        "Content-Type": kind === "photo" ? "image/jpeg" : "audio/mp4",
        "x-amz-checksum-sha256": "ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=",
        "content-length": "3",
      },
      expiresAt: "2026-09-28T06:15:00Z",
    },
  };
}
/** I return actual Response objects so adapter parsing is exercised. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type":
        status >= 400 ? "application/problem+json" : "application/json",
    },
  });
}
