const statuses: Readonly<Record<string, number>> = {
  VALIDATION_FAILED: 400,
  SESSION_INVALID: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  INVALID_TRANSITION: 409,
  STALE_SUBJECT_HASH: 409,
  APPROVER_NOT_DISTINCT: 409,
  APPROVALS_REQUIRED: 409,
  OVERLAPPING_CONTRACT: 409,
  SUCCESSOR_EXISTS: 409,
  REASON_REQUIRED: 422,
  IDEMPOTENCY_KEY_REUSED: 422,
  SCHEDULE_TOTAL_MISMATCH: 422,
  TENANT_DOCUMENTS_REQUIRED: 422,
  OWNER_ACCOUNT_REQUIRED: 422,
  UNIT_BLOCKED: 422,
  TENANT_REQUIRED: 422,
  INVALID_INPUT: 422,
  MODEL_UNAVAILABLE: 503,
  UNAVAILABLE: 503,
};
export class WorkflowProblem extends Error {
  readonly status: number;
  constructor(
    readonly code: string,
    readonly field?: string,
  ) {
    super(code);
    this.status = statuses[code] ?? 503;
  }
}
export function problemResponse(error: WorkflowProblem): Response {
  return new Response(
    JSON.stringify({
      type: "about:blank",
      title: error.code.replaceAll("_", " "),
      status: error.status,
      code: error.code,
      ...(error.code === "MODEL_UNAVAILABLE"
        ? { detail: "The clause can be translated by hand." }
        : {}),
      ...(error.field ? { field: error.field } : {}),
    }),
    {
      status: error.status,
      headers: { "Content-Type": "application/problem+json" },
    },
  );
}
export function databaseProblem(error: unknown): WorkflowProblem {
  if (error instanceof WorkflowProblem) return error;
  const message = error instanceof Error ? error.message : "";
  if (/23P01|exclusion constraint/i.test(message))
    return new WorkflowProblem("OVERLAPPING_CONTRACT");
  if (message.includes("approval_approved_person_idx"))
    return new WorkflowProblem("APPROVER_NOT_DISTINCT");
  if (message.includes("contract_company_id_revision_of_id_key"))
    return new WorkflowProblem("SUCCESSOR_EXISTS");
  if (/23503|foreign key constraint/.test(message))
    return new WorkflowProblem("INVALID_INPUT", "reference");
  if (/23505|duplicate key/.test(message))
    return new WorkflowProblem("INVALID_INPUT", "duplicate");
  if (/AQ004|Row exceeds 48 KiB/.test(message))
    return new WorkflowProblem("INVALID_INPUT", "body");
  if (/23514|check constraint/.test(message))
    return new WorkflowProblem("INVALID_INPUT", "terms");
  return new WorkflowProblem("UNAVAILABLE");
}
