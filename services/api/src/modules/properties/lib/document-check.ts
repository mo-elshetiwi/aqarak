import { checkUploadContent } from "./domain";
import type { StoredHead } from "./storage";
import { checksumBase64 } from "./storage";
import { fail } from "./problem";
export function checkStoredHead(
  declared: { sha256: string; byteSize: number },
  head: StoredHead | null,
): { versionId: string; rejected: boolean } {
  if (!head) fail(409, "UPLOAD_NOT_FOUND");
  return {
    versionId: head.versionId,
    rejected:
      head.byteSize !== declared.byteSize ||
      head.checksumSha256 !== checksumBase64(declared.sha256),
  };
}
export function scanDecision(input: {
  contentType: string;
  head: Uint8Array;
  tag: string | null;
}): {
  status: "uploaded" | "scan_clean" | "scan_rejected";
  result: string | null;
} {
  if (
    !checkUploadContent({ contentType: input.contentType, head: input.head }).ok
  )
    return { status: "scan_rejected", result: "content_type_mismatch" };
  if (input.tag === null) return { status: "uploaded", result: null };
  return input.tag === "NO_THREATS_FOUND"
    ? { status: "scan_clean", result: "malware_scan_no_threats_found" }
    : {
        status: "scan_rejected",
        result: `malware_scan_${input.tag.toLowerCase()}`,
      };
}
