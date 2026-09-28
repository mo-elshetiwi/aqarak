import { z } from "zod";
import { refuse, type DomainError } from "../errors";
import { ok, type Result } from "../result";
import type { DocumentsErrorCode } from "./errors";

/** Lists supported declared MIME types. */
export const uploadContentType = z.enum([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "video/mp4",
]);
/** Represents a supported upload's content type. */
export type UploadContentType = z.infer<typeof uploadContentType>;
/** Defines binary-megabyte limits for each supported MIME type. */
export const uploadLimits: Readonly<Record<UploadContentType, number>> = {
  "application/pdf": 20 * 1_048_576,
  "image/jpeg": 20 * 1_048_576,
  "image/png": 20 * 1_048_576,
  "audio/mp4": 25 * 1_048_576,
  "audio/mpeg": 25 * 1_048_576,
  "audio/wav": 25 * 1_048_576,
  "video/mp4": 100 * 1_048_576,
};
type Check = Result<void, DomainError<DocumentsErrorCode>>;

/** Checks the declared size before upload authorization. */
export function checkUploadRequest(input: {
  readonly contentType: string;
  readonly byteSize: number;
}): Check {
  const type = uploadContentType.safeParse(input.contentType);
  if (!type.success) return refuse("UNSUPPORTED_TYPE", "content_type");
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize <= 0)
    return refuse("INVALID_INPUT", "byte_size");
  const limit = uploadLimits[type.data];
  return input.byteSize > limit
    ? refuse("UPLOAD_TOO_LARGE", `max_bytes:${String(limit)}`)
    : ok(undefined);
}

function bytesAt(
  head: Uint8Array,
  offset: number,
  bytes: readonly number[],
): boolean {
  return bytes.every((byte, index) => head[offset + index] === byte);
}

/** Identifies supported formats from their magic bytes without trusting file extensions. */
export function sniffContentType(head: Uint8Array): UploadContentType | null {
  if (bytesAt(head, 0, [0x25, 0x50, 0x44, 0x46])) return "application/pdf";
  if (bytesAt(head, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return "image/png";
  if (bytesAt(head, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (head.length >= 12 && bytesAt(head, 4, [0x66, 0x74, 0x79, 0x70])) {
    return bytesAt(head, 8, [0x4d, 0x34, 0x41, 0x20])
      ? "audio/mp4"
      : "video/mp4";
  }
  if (bytesAt(head, 0, [0x49, 0x44, 0x33])) return "audio/mpeg";
  const second = head[1];
  if (head[0] === 0xff && second !== undefined && (second & 0xe0) === 0xe0)
    return "audio/mpeg";
  if (
    bytesAt(head, 0, [0x52, 0x49, 0x46, 0x46]) &&
    bytesAt(head, 8, [0x57, 0x41, 0x56, 0x45])
  )
    return "audio/wav";
  return null;
}

/** Requires the bytes received to match the supported declared MIME type. */
export function checkUploadContent(input: {
  readonly contentType: string;
  readonly head: Uint8Array;
}): Check {
  const type = uploadContentType.safeParse(input.contentType);
  if (!type.success) return refuse("UNSUPPORTED_TYPE", "content_type");
  return sniffContentType(input.head) === type.data
    ? ok(undefined)
    : refuse("CONTENT_TYPE_MISMATCH", "content_type");
}

/** Limits extraction to at most twenty positive, whole pages. */
export function checkExtractionPages(pageCount: number): Check {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1)
    return refuse("INVALID_INPUT", "page_count");
  return pageCount > 20
    ? refuse("TOO_MANY_PAGES", "max_pages:20")
    : ok(undefined);
}
