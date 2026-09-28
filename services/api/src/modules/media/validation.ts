import { uploadBodySchema, type UploadBody } from "../maintenance/contract";
import { Problem } from "../maintenance/problem";

export function validateUpload(value: unknown): UploadBody {
  const result = uploadBodySchema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const field = String(issue?.path[0] ?? "body");
  if (issue?.code === "custom") {
    const code =
      field === "contentType" ? "UNSUPPORTED_TYPE" : "LIMIT_EXCEEDED";
    throw new Problem(422, code, issue.message, { field });
  }
  if (field === "kind")
    throw new Problem(
      422,
      "UNSUPPORTED_TYPE",
      "Kind must be photo or voice_note.",
      { field },
    );
  if (field === "byteSize")
    throw new Problem(
      422,
      "LIMIT_EXCEEDED",
      "byteSize must be a positive integer, at most 20 MiB for photos or 25 MiB for voice.",
      { field },
    );
  if (field === "durationMs")
    throw new Problem(
      422,
      "LIMIT_EXCEEDED",
      "Voice durationMs must be an integer from 0 to 300000.",
      { field },
    );
  throw new Problem(
    400,
    "INVALID_REQUEST",
    "The request does not match the required schema.",
    { field },
  );
}
