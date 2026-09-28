/* eslint-disable max-params -- Transport methods keep session, scope, subject, body and replay key explicit. */
import "server-only";
import { err, ok, type Result } from "@aqarak/domain";
import { z } from "zod";
import { createContractsMock } from "./contracts-mock";
import {
  approvalsSchema,
  detailSchema,
  draftingOptionsSchema,
  listSchema,
  notificationReadSchema,
  notificationsSchema,
  problemSchema,
  suggestionSchema,
  type ContractDetail,
  type DecisionInput,
  type DraftInput,
  type DraftingOptions,
  type EditInput,
  type Problem,
  type ReasonInput,
  type VersionInput,
} from "./schemas";

type Outcome<T> = Promise<Result<T, Problem>>;
type Read<T> = (
  sessionId: string,
  companyId: string,
  contractId: string,
) => Outcome<T>;
type Command<T> = (
  sessionId: string,
  companyId: string,
  contractId: string,
  input: T,
  key: string,
) => Outcome<ContractDetail>;
export interface ListQuery {
  status?: string;
  limit?: number;
  cursor?: string;
}
export interface ContractsApi {
  list(
    sessionId: string,
    companyId: string,
    query?: ListQuery,
  ): Outcome<z.infer<typeof listSchema>>;
  get: Read<ContractDetail>;
  draftingOptions(
    sessionId: string,
    companyId: string,
  ): Outcome<DraftingOptions>;
  create(
    sessionId: string,
    companyId: string,
    input: DraftInput,
    key: string,
  ): Outcome<ContractDetail>;
  edit: Command<EditInput>;
  submit: Command<VersionInput>;
  approveOwner: Command<DecisionInput>;
  returnOwner: Command<ReasonInput>;
  acceptTenant: Command<DecisionInput>;
  returnTenant: Command<ReasonInput>;
  withdraw: Command<ReasonInput>;
  cancel: Command<ReasonInput>;
  revise: Command<VersionInput>;
  listApprovals(
    sessionId: string,
    companyId: string,
  ): Outcome<z.infer<typeof approvalsSchema>>;
  listNotifications(
    sessionId: string,
    companyId: string,
    limit?: number,
  ): Outcome<z.infer<typeof notificationsSchema>>;
  markNotificationRead(
    sessionId: string,
    companyId: string,
    id: string,
    key: string,
  ): Outcome<z.infer<typeof notificationReadSchema>>;
  suggestClause(
    sessionId: string,
    companyId: string,
    contractId: string,
    input: { textEn: string },
    key: string,
  ): Outcome<z.infer<typeof suggestionSchema>>;
}
export function createContractsHttp(
  baseUrl: string,
  transport: typeof fetch = fetch,
): ContractsApi {
  async function request<T>(
    sessionId: string,
    companyId: string,
    path: string,
    schema: z.ZodType<T>,
    method = "GET",
    body?: unknown,
    key?: string,
    expectedStatus = 200,
    timeoutMs = 10_000,
  ): Outcome<T> {
    const unavailable = (): Result<never, Problem> =>
      err({ status: 503, code: "UNAVAILABLE" });
    try {
      const response = await transport(
        `${baseUrl}/v1/companies/${encodeURIComponent(companyId)}${path}`,
        {
          method,
          headers: {
            Authorization: `Session ${sessionId}`,
            Accept: "application/json",
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
            ...(key === undefined ? {} : { "Idempotency-Key": key }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
      const json: unknown = await response.json();
      if (!response.ok) {
        const problem = problemSchema.safeParse(json);
        return problem.success && problem.data.status === response.status
          ? err(problem.data)
          : unavailable();
      }
      if (response.status !== expectedStatus) return unavailable();
      const parsed = schema.safeParse(json);
      return parsed.success ? ok(parsed.data) : unavailable();
    } catch {
      return unavailable();
    }
  }
  const path = (id: string): string => `/contracts/${encodeURIComponent(id)}`;
  function command<T>(
    suffix: string,
    method = "POST",
    status = 200,
  ): Command<T> {
    return (session, company, id, input, key) =>
      request(
        session,
        company,
        `${path(id)}/${suffix}`,
        detailSchema,
        method,
        input,
        key,
        status,
      );
  }
  return {
    list: (s, c, query = {}) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query))
        if (value !== undefined) params.set(key, String(value));
      return request(
        s,
        c,
        `/contracts${params.size ? `?${params}` : ""}`,
        listSchema,
      );
    },
    get: (s, c, id) => request(s, c, path(id), detailSchema),
    draftingOptions: (s, c) =>
      request(s, c, "/contracts/drafting-options", draftingOptionsSchema),
    create: (s, c, input, key) =>
      request(s, c, "/contracts", detailSchema, "POST", input, key, 201),
    edit: command("draft", "PUT"),
    submit: command("submit"),
    approveOwner: command("owner-approval"),
    returnOwner: command("owner-return"),
    acceptTenant: command("tenant-acceptance"),
    returnTenant: command("tenant-return"),
    withdraw: command("withdraw"),
    cancel: command("cancel"),
    revise: command("revisions", "POST", 201),
    listApprovals: (s, c) => request(s, c, "/approvals", approvalsSchema),
    listNotifications: (s, c, limit) =>
      request(
        s,
        c,
        `/notifications${limit === undefined ? "" : `?limit=${encodeURIComponent(limit)}`}`,
        notificationsSchema,
      ),
    markNotificationRead: (s, c, id, key) =>
      request(
        s,
        c,
        `/notifications/${encodeURIComponent(id)}/read`,
        notificationReadSchema,
        "POST",
        {},
        key,
      ),
    suggestClause: (s, c, id, input, key) =>
      request(
        s,
        c,
        `${path(id)}/clause-suggestions`,
        suggestionSchema,
        "POST",
        input,
        key,
        200,
        25_000,
      ),
  };
}
function configuredMode(): "mock" | "http" {
  const mode = process.env.AQARAK_API_MODE;
  if (
    mode === "mock" ||
    (mode === undefined &&
      (process.env.NODE_ENV === "development" ||
        process.env.NODE_ENV === "test"))
  )
    return "mock";
  if (mode !== "http") throw new Error("AQARAK_API_MODE must be mock or http");
  return "http";
}
export function getContractsApi(): ContractsApi {
  if (configuredMode() === "mock") return createContractsMock();
  let base: string;
  try {
    const value = process.env.AQARAK_API_BASE_URL;
    if (!value) throw new Error();
    const url = new URL(value);
    const loopback =
      url.hostname === "localhost" ||
      url.hostname === "[::1]" ||
      /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
    if (
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error();
    base = url.href.replace(/\/$/, "");
  } catch {
    throw new Error(
      "AQARAK_API_BASE_URL must be an HTTPS URL or an HTTP loopback URL",
    );
  }
  return createContractsHttp(base);
}
