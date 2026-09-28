import { z } from "zod";
import {
  ReportError,
  reportErrorCodeSchema,
  type ReportClient,
} from "./client";
import {
  unitsSchema,
  ticketsResponseSchema,
  ticketResponseSchema,
  mediaLinkSchema,
  uploadResponseSchema,
  mediaResponseSchema,
  intakeResponseSchema,
  confirmResponseSchema,
  uploadBodySchema,
  intakeBodySchema,
  completeBodySchema,
  confirmIntakeBodySchema,
  rejectIntakeBodySchema,
} from "./contract";
interface RequestOptions<T> {
  path: string;
  schema: z.ZodType<T>;
  status: number;
  body?: unknown;
  key?: string;
  signal?: AbortSignal | undefined;
}
async function problem(response: Response): Promise<ReportError> {
  if (response.status === 404) return new ReportError("NOT_FOUND");
  if (response.status === 403) return new ReportError("NOT_AUTHORISED");
  try {
    const body = z
      .object({ code: reportErrorCodeSchema })
      .safeParse(await response.json());
    return new ReportError(body.success ? body.data.code : "could_not_load");
  } catch {
    return new ReportError("could_not_load");
  }
}
/** I separate the authorised API transport from the unauthenticated object transport. */
export function createHttpReportClient(
  baseUrl: string,
  authorisedFetch: typeof fetch,
  plainFetch: typeof fetch = fetch,
): ReportClient {
  async function request<T>(
    companyId: string,
    options: RequestOptions<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const abort = (): void => {
      controller.abort();
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ReportError("network_unavailable"));
      }, 30_000);
    });
    async function perform(): Promise<T> {
      const headers: Record<string, string> = {
        Accept: "application/json, application/problem+json",
      };
      if (options.key) {
        headers["Content-Type"] = "application/json";
        headers["Idempotency-Key"] = options.key;
      }
      let response: Response;
      try {
        response = await authorisedFetch(
          `${baseUrl.replace(/\/$/, "")}/v1/companies/${encodeURIComponent(companyId)}${options.path}`,
          {
            method: options.key ? "POST" : "GET",
            headers,
            signal: controller.signal,
            ...(options.body === undefined
              ? {}
              : { body: JSON.stringify(options.body) }),
          },
        );
      } catch {
        throw new ReportError("network_unavailable");
      }
      if (!response.ok) throw await problem(response);
      if (response.status !== options.status)
        throw new ReportError("unexpected_response");
      try {
        return options.schema.parse(await response.json());
      } catch {
        throw new ReportError("unexpected_response");
      }
    }
    try {
      return await Promise.race([perform(), timeout]);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }
  }
  return {
    tickets(companyId, cursor, signal) {
      return request(companyId, {
        path: `/maintenance/tickets?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        schema: ticketsResponseSchema,
        status: 200,
        signal,
      });
    },
    async ticket(companyId, ticketId, signal) {
      return (
        await request(companyId, {
          path: `/maintenance/tickets/${encodeURIComponent(ticketId)}`,
          schema: ticketResponseSchema,
          status: 200,
          signal,
        })
      ).ticket;
    },
    mediaLink(companyId, mediaId, signal) {
      return request(companyId, {
        path: `/media/${encodeURIComponent(mediaId)}/download`,
        schema: mediaLinkSchema,
        status: 200,
        signal,
      });
    },
    async units(companyId, signal) {
      return (
        await request(companyId, {
          path: "/maintenance/units",
          schema: unitsSchema,
          status: 200,
          signal,
        })
      ).items;
    },
    createUpload(companyId, body, key) {
      return request(companyId, {
        path: "/media/uploads",
        body: uploadBodySchema.parse(body),
        key,
        schema: uploadResponseSchema,
        status: 201,
      });
    },
    async putObject(upload, bytes) {
      const headers = Object.fromEntries(
        Object.entries(upload.headers).filter(
          ([name]) =>
            !["content-length", "authorization"].includes(name.toLowerCase()),
        ),
      );
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ReportError("upload_failed"));
        }, 60_000);
      });
      try {
        const response = await Promise.race([
          plainFetch(upload.url, {
            method: "PUT",
            headers,
            body: Uint8Array.from(bytes).buffer,
            signal: controller.signal,
          }),
          timeout,
        ]);
        if (!response.ok) throw new ReportError("upload_failed");
      } catch {
        throw new ReportError("upload_failed");
      } finally {
        clearTimeout(timer);
      }
    },
    async completeUpload(companyId, mediaId, body, key) {
      return (
        await request(companyId, {
          path: `/media/${encodeURIComponent(mediaId)}/complete`,
          body: completeBodySchema.parse(body),
          key,
          schema: mediaResponseSchema,
          status: 200,
        })
      ).media;
    },
    async createIntake(companyId, body, key) {
      return (
        await request(companyId, {
          path: "/maintenance/intakes",
          body: intakeBodySchema.parse(body),
          key,
          schema: intakeResponseSchema,
          status: 201,
        })
      ).intake;
    },
    async getIntake(companyId, intakeId, signal) {
      return (
        await request(companyId, {
          path: `/maintenance/intakes/${encodeURIComponent(intakeId)}`,
          schema: intakeResponseSchema,
          status: 200,
          signal,
        })
      ).intake;
    },
    confirmIntake(companyId, intakeId, body, key) {
      return request(companyId, {
        path: `/maintenance/intakes/${encodeURIComponent(intakeId)}/confirm`,
        body: confirmIntakeBodySchema.parse(body),
        key,
        schema: confirmResponseSchema,
        status: 201,
      });
    },
    async rejectIntake(companyId, intakeId, body, key) {
      return (
        await request(companyId, {
          path: `/maintenance/intakes/${encodeURIComponent(intakeId)}/reject`,
          body: rejectIntakeBodySchema.parse(body),
          key,
          schema: intakeResponseSchema,
          status: 200,
        })
      ).intake;
    },
  };
}
