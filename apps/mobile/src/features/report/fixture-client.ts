import { getMessages } from "@aqarak/i18n";
import { ReportError, asReportError, type ReportClient } from "./client";
import type { IntakeView, MediaView, TicketView } from "./contract";
const syntheticUnitId = "30000000-0000-4000-8000-000000000001";
const syntheticTime = "2026-09-28T06:00:00Z";
/** I keep synthetic records isolated by the supplied company and command key. */
export function createFixtureReportClient(): ReportClient {
  let counter = 1;
  const media = new Map<string, MediaView>();
  const tickets = new Map<string, TicketView>();
  const intakes = new Map<string, IntakeView>();
  const commands = new Map<string, { body: string; value: unknown }>();
  function id(): string {
    counter += 1;
    return `30000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
  }
  function replay<T>(
    scope: string,
    body: unknown,
    operation: () => T,
  ): Promise<T> {
    try {
      const previous = commands.get(scope);
      const signature = JSON.stringify(body);
      if (previous) {
        if (previous.body !== signature)
          throw new ReportError("IDEMPOTENCY_KEY_REUSED");
        return Promise.resolve(previous.value as T);
      }
      const value = operation();
      commands.set(scope, { body: signature, value });
      return Promise.resolve(value);
    } catch (error) {
      return Promise.reject(asReportError(error));
    }
  }
  function intake(company: string, intakeId: string): IntakeView {
    const value = intakes.get(`${company}:${intakeId}`);
    if (!value) throw new ReportError("NOT_FOUND");
    return value;
  }
  function ready(
    company: string,
    intakeId: string,
    version: number,
  ): IntakeView {
    const value = intake(company, intakeId);
    if (value.status === "expired") throw new ReportError("EXPIRED");
    if (value.status !== "ready") throw new ReportError("ALREADY_DECIDED");
    if (value.version !== version) throw new ReportError("STALE_VERSION");
    return value;
  }
  return {
    tickets(company, cursor) {
      const items = [...tickets.entries()]
        .filter(([key]) => key.startsWith(`${company}:`))
        .map(([, value]) => value)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const offset = Number(cursor ?? 0);
      return Promise.resolve({
        items: items.slice(offset, offset + 20),
        nextCursor: offset + 20 < items.length ? String(offset + 20) : null,
      });
    },
    ticket(company, ticketId) {
      const value = tickets.get(`${company}:${ticketId}`);
      return value
        ? Promise.resolve(value)
        : Promise.reject(new ReportError("NOT_FOUND"));
    },
    mediaLink() {
      return Promise.reject(new ReportError("UPLOAD_NOT_READY"));
    },
    units() {
      return Promise.resolve([
        {
          id: syntheticUnitId,
          unitNo: "104",
          propertyName: "Synthetic / تجريبي",
          label: "Synthetic unit 104 / وحدة تجريبية 104",
        },
      ]);
    },
    createUpload(company, body, key) {
      return replay(`${company}:upload:${key}`, body, () => {
        const item: MediaView = {
          ...body,
          id: id(),
          durationMs: body.durationMs ?? null,
          status: "awaiting_upload",
          version: 1,
          createdAt: syntheticTime,
        };
        media.set(`${company}:${item.id}`, item);
        return {
          media: item,
          upload: {
            method: "PUT" as const,
            url: `synthetic:${item.id}`,
            headers: {},
            expiresAt: "2026-09-29T06:00:00Z",
          },
        };
      });
    },
    putObject() {
      return Promise.resolve();
    },
    completeUpload(company, mediaId, body, key) {
      return replay(`${company}:complete:${mediaId}:${key}`, body, () => {
        const item = media.get(`${company}:${mediaId}`);
        if (!item) throw new ReportError("NOT_FOUND");
        if (item.version !== body.expectedVersion)
          throw new ReportError("STALE_VERSION");
        const completed: MediaView = {
          ...item,
          version: item.version + 1,
          status: "scan_clean",
        };
        media.set(`${company}:${mediaId}`, completed);
        return completed;
      });
    },
    createIntake(company, body, key) {
      return replay(`${company}:intake:${key}`, body, () => {
        const attachments = [body.voiceMediaId, ...body.photoMediaIds]
          .filter((value): value is string => value !== null)
          .map((mediaId) => {
            const item = media.get(`${company}:${mediaId}`);
            if (item?.status !== "scan_clean")
              throw new ReportError("MEDIA_NOT_READY");
            return item;
          });
        const text =
          body.typedText ??
          getMessages(body.language).Report.syntheticTranscript;
        const value: IntakeView = {
          id: id(),
          version: 1,
          status: "ready",
          unitId: body.unitId,
          language: body.language,
          transcript: body.voiceMediaId ? text : null,
          typedText: body.typedText,
          category: "plumbing",
          priority: "urgent",
          safetyFlags: [],
          description: text.slice(0, 1000),
          payer: "owner",
          transcription: {
            mode: body.voiceMediaId ? "model" : "not_requested",
          },
          triage: { mode: "model", confidence: 0.9 },
          media: attachments,
          ticketId: null,
          createdAt: syntheticTime,
        };
        intakes.set(`${company}:${value.id}`, value);
        return value;
      });
    },
    getIntake(company, intakeId) {
      try {
        return Promise.resolve(intake(company, intakeId));
      } catch (error) {
        return Promise.reject(asReportError(error));
      }
    },
    confirmIntake(company, intakeId, body, key) {
      return replay(`${company}:confirm:${intakeId}:${key}`, body, () => {
        const value = ready(company, intakeId, body.expectedVersion);
        const ticket: TicketView = {
          ...body,
          id: id(),
          version: 1,
          unitId: value.unitId,
          unitLabel: "Synthetic unit 104 / وحدة تجريبية 104",
          status: "reported",
          safetyCritical: body.safetyFlags.length > 0,
          createdAt: syntheticTime,
          reportedByMe: true,
          payer: value.payer,
          channel: value.media.some((item) => item.kind === "voice_note")
            ? "voice"
            : "mobile_form",
          intakeId,
          media: value.media,
        };
        const committed: IntakeView = {
          ...value,
          ...body,
          status: "committed",
          version: value.version + 1,
          ticketId: ticket.id,
        };
        tickets.set(`${company}:${ticket.id}`, ticket);
        intakes.set(`${company}:${intakeId}`, committed);
        return { ticket, intake: committed };
      });
    },
    rejectIntake(company, intakeId, body, key) {
      return replay(`${company}:reject:${intakeId}:${key}`, body, () => {
        const value = ready(company, intakeId, body.expectedVersion);
        const rejected: IntakeView = {
          ...value,
          status: "rejected",
          version: value.version + 1,
        };
        intakes.set(`${company}:${intakeId}`, rejected);
        return rejected;
      });
    },
  };
}
