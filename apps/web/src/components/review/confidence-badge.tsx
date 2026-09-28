"use client";
import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { Eye, LockKeyhole, CircleDashed } from "lucide-react";
import type { ConfidenceCategory } from "./types";
const styles = {
  confirm:
    "bg-confidence-confirm-bg text-confidence-confirm-fg border-confidence-confirm-border",
  check: "bg-confidence-check-bg text-confidence-check-fg border-ai-border",
  suggested:
    "bg-confidence-suggested-bg text-confidence-suggested-fg border-border",
};
const icons = { confirm: LockKeyhole, check: Eye, suggested: CircleDashed };
export function ConfidenceBadge({
  category,
}: {
  category: ConfidenceCategory;
}): ReactElement {
  const t = useTranslations("Review");
  const Icon = icons[category];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border ps-2 pe-2 py-1 text-caption-strong ${styles[category]}`}
    >
      <Icon aria-hidden="true" className="size-4" />
      {t(`confidence.${category}`)}
    </span>
  );
}
