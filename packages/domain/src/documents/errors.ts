import { z } from "zod";
import { coreErrorCode } from "../errors";

/** Lists closed refusal codes for document lifecycle and upload checks. */
export const documentsErrorCode = z.enum([
  ...coreErrorCode.options,
  "SCAN_NOT_CLEAN",
  "NOT_A_PERSON_COMMAND",
  "NOT_A_PIPELINE_COMMAND",
  "UNSUPPORTED_TYPE",
  "UPLOAD_TOO_LARGE",
  "CONTENT_TYPE_MISMATCH",
  "TOO_MANY_PAGES",
]);
/** Represents a typed document refusal. */
export type DocumentsErrorCode = z.infer<typeof documentsErrorCode>;
