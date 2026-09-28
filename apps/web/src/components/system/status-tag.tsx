"use client";
import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import {
  CircleDashed,
  Clock,
  Contrast,
  CircleCheck,
  TriangleAlert,
  CircleMinus,
} from "lucide-react";
import { statusTones } from "@aqarak/ui-tokens";
import { statusCatalogue, type StatusTagProps } from "./status-catalogue";

const icons = {
  "circle-dashed": CircleDashed,
  clock: Clock,
  contrast: Contrast,
  "circle-check": CircleCheck,
  "triangle-alert": TriangleAlert,
  "circle-minus": CircleMinus,
};
const toneClasses = {
  neutral:
    "bg-status-neutral-bg text-status-neutral-fg border-status-neutral-border",
  attention:
    "bg-status-attention-bg text-status-attention-fg border-status-attention-border",
  progress:
    "bg-status-progress-bg text-status-progress-fg border-status-progress-border",
  success:
    "bg-status-success-bg text-status-success-fg border-status-success-border",
  danger:
    "bg-status-danger-bg text-status-danger-fg border-status-danger-border",
  muted: "bg-status-muted-bg text-status-muted-fg border-status-muted-border",
} as const;
/** Fixed state semantics always pair the translated word with an icon shape. */
export function StatusTag({ entity, state }: StatusTagProps): ReactElement {
  const translate = useTranslations("Status");
  const states: Readonly<Record<string, keyof typeof statusTones>> =
    statusCatalogue[entity];
  const tone = states[state] ?? "neutral";
  const Icon = icons[statusTones[tone].icon];
  return (
    <span
      data-tone={tone}
      className={`inline-flex h-5 items-center gap-1 rounded-sm border ps-2 pe-2 text-caption-strong whitespace-nowrap ${toneClasses[tone]}`}
    >
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      {translate(`${entity}.${state}`)}
    </span>
  );
}
export { statusCatalogue, statusEntries } from "./status-catalogue";
export type { StatusTagProps, StatusEntity } from "./status-catalogue";
