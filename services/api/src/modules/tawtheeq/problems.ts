import type { TawtheeqErrorCode } from "@aqarak/domain";
import { Refusal, type ProblemCode } from "../audit/kernel";

export function domainRefusal(
  domainCode: TawtheeqErrorCode | "SCAN_PENDING" | "SCAN_REJECTED",
  recordId: string,
): Refusal {
  const code: ProblemCode =
    domainCode === "REASON_REQUIRED"
      ? "REASON_REQUIRED"
      : domainCode === "VERSION_CONFLICT"
        ? "STALE_VERSION"
        : domainCode === "NOT_NAMED_PARTY" || domainCode === "NOT_OWN_SESSION"
          ? "NOT_PERMITTED"
          : [
                "INVALID_INPUT",
                "MARK_EQUIVALENT_NOT_ALLOWED",
                "IDENTITY_MISMATCH",
              ].includes(domainCode)
            ? "VALIDATION_FAILED"
            : "INVALID_TRANSITION";
  return new Refusal(
    code,
    { type: "tawtheeq_record", id: recordId },
    undefined,
    domainCode,
  );
}
/** Domain input errors use 422 while the kernel retains 400 for malformed transport schemas. */
export async function domainProblemStatus(
  response: Response,
): Promise<Response> {
  if (response.status !== 400) return response;
  const body: unknown = await response.clone().json();
  if (typeof body !== "object" || body === null || !("domainCode" in body))
    return response;
  return new Response(
    JSON.stringify({ ...body, status: 422, title: "Unprocessable Content" }),
    { status: 422, headers: response.headers },
  );
}
