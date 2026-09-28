"use client";
import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import type { VersionItem } from "../contract";

export function DocumentProcessing({
  version,
  namespace,
  scanPending = version.processingStatus === "uploaded",
}: {
  version: VersionItem;
  namespace: "Owners" | "Properties";
  scanPending?: boolean;
}): ReactElement {
  const t = useTranslations(namespace);
  const reason = version.scanResult;
  const category =
    reason === "checksum_mismatch" || reason === "content_type_mismatch"
      ? reason
      : reason?.startsWith("malware_scan_")
        ? "malware"
        : "unknown";
  return (
    <span aria-live="polite">
      {version.processingStatus === "scan_rejected"
        ? t(`scanReasons.${category}`)
        : version.processingStatus === "uploaded" && scanPending
          ? t("checking")
          : t(`processing.${version.processingStatus}`)}
    </span>
  );
}

export function documentAction(
  version?: VersionItem | null,
): "upload" | "uploadAgain" | "check" | "review" {
  if (!version) return "upload";
  if (version.processingStatus === "scan_rejected") return "uploadAgain";
  if (["awaiting_upload", "uploaded"].includes(version.processingStatus))
    return "check";
  return "review";
}
