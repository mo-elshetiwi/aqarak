import { getConfig, type RuntimeConfig } from "../../config";
import type { ProblemCode } from "./contract";
export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: ProblemCode;
  field?: string;
  currentVersion?: number;
  currentStatus?: string;
}
export class Problem extends Error {
  readonly body: ProblemBody;
  constructor(
    status: number,
    code: ProblemCode,
    detail: string,
    extra: Pick<ProblemBody, "field" | "currentVersion" | "currentStatus"> = {},
  ) {
    super(code);
    this.body = {
      type: "about:blank",
      title: code,
      status,
      detail,
      code,
      ...extra,
    };
  }
}
export class Denied extends Problem {
  constructor(
    readonly subjectType: string,
    readonly subjectId: string,
    status = 404,
    code: ProblemCode = "NOT_FOUND",
  ) {
    super(
      status,
      code,
      status === 404
        ? "The requested resource was not found."
        : "This role cannot report maintenance.",
    );
  }
}
export function problemResponse(error: Problem): Response {
  return Response.json(error.body, {
    status: error.body.status,
    headers: { "Content-Type": "application/problem+json" },
  });
}
export function requiredEnvironment(name: keyof RuntimeConfig): string {
  const value = getConfig()[name];
  if (typeof value !== "string" || !value)
    throw new Problem(
      503,
      "SERVICE_UNAVAILABLE",
      `Missing configuration: ${name}.`,
    );
  return value;
}
