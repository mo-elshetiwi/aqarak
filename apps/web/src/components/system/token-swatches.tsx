"use client";
import type { ReactElement } from "react";
const swatches = [
  ["background", "bg-background"],
  ["foreground", "bg-foreground"],
  ["card", "bg-card"],
  ["card-foreground", "bg-card-foreground"],
  ["popover", "bg-popover"],
  ["popover-foreground", "bg-popover-foreground"],
  ["primary", "bg-primary"],
  ["primary-foreground", "bg-primary-foreground"],
  ["secondary", "bg-secondary"],
  ["secondary-foreground", "bg-secondary-foreground"],
  ["muted", "bg-muted"],
  ["muted-foreground", "bg-muted-foreground"],
  ["accent", "bg-accent"],
  ["accent-foreground", "bg-accent-foreground"],
  ["destructive", "bg-destructive"],
  ["destructive-foreground", "bg-destructive-foreground"],
  ["border", "bg-border"],
  ["input", "bg-input"],
  ["ring", "bg-ring"],
  ["sidebar", "bg-sidebar"],
  ["sidebar-foreground", "bg-sidebar-foreground"],
  ["sidebar-accent", "bg-sidebar-accent"],
  ["sidebar-accent-foreground", "bg-sidebar-accent-foreground"],
  ["brand", "bg-brand"],
  ["brand-foreground", "bg-brand-foreground"],
  ["brand-subtle", "bg-brand-subtle"],
  ["ai-bg", "bg-ai-bg"],
  ["ai-fg", "bg-ai-fg"],
  ["ai-border", "bg-ai-border"],
  ["confidence-confirm-fg", "bg-confidence-confirm-fg"],
  ["confidence-confirm-bg", "bg-confidence-confirm-bg"],
  ["confidence-confirm-border", "bg-confidence-confirm-border"],
  ["confidence-check-fg", "bg-confidence-check-fg"],
  ["confidence-check-bg", "bg-confidence-check-bg"],
  ["confidence-suggested-fg", "bg-confidence-suggested-fg"],
  ["confidence-suggested-bg", "bg-confidence-suggested-bg"],
  ["status-neutral-bg", "bg-status-neutral-bg"],
  ["status-neutral-fg", "bg-status-neutral-fg"],
  ["status-neutral-border", "bg-status-neutral-border"],
  ["status-neutral-solid", "bg-status-neutral-solid"],
  ["status-attention-bg", "bg-status-attention-bg"],
  ["status-attention-fg", "bg-status-attention-fg"],
  ["status-attention-border", "bg-status-attention-border"],
  ["status-attention-solid", "bg-status-attention-solid"],
  ["status-progress-bg", "bg-status-progress-bg"],
  ["status-progress-fg", "bg-status-progress-fg"],
  ["status-progress-border", "bg-status-progress-border"],
  ["status-progress-solid", "bg-status-progress-solid"],
  ["status-success-bg", "bg-status-success-bg"],
  ["status-success-fg", "bg-status-success-fg"],
  ["status-success-border", "bg-status-success-border"],
  ["status-success-solid", "bg-status-success-solid"],
  ["status-danger-bg", "bg-status-danger-bg"],
  ["status-danger-fg", "bg-status-danger-fg"],
  ["status-danger-border", "bg-status-danger-border"],
  ["status-danger-solid", "bg-status-danger-solid"],
  ["status-muted-bg", "bg-status-muted-bg"],
  ["status-muted-fg", "bg-status-muted-fg"],
  ["status-muted-border", "bg-status-muted-border"],
  ["status-muted-solid", "bg-status-muted-solid"],
  ["overlay", "bg-overlay"],
  ["chart-1", "bg-chart-1"],
  ["chart-2", "bg-chart-2"],
  ["chart-3", "bg-chart-3"],
  ["chart-4", "bg-chart-4"],
  ["chart-5", "bg-chart-5"],
  ["chart-6", "bg-chart-6"],
  ["chart-7", "bg-chart-7"],
  ["sidebar-border", "bg-sidebar-border"],
  ["sidebar-ring", "bg-sidebar-ring"],
  ["sidebar-primary", "bg-sidebar-primary"],
  ["sidebar-primary-foreground", "bg-sidebar-primary-foreground"],
] as const;
export function TokenSwatches(): ReactElement {
  return (
    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {swatches.map(([name, className]) => (
        <div key={name} className="space-y-2">
          <dd
            aria-hidden="true"
            className={`h-12 rounded-sm border ${className}`}
          />
          <dt className="break-all font-mono text-mono">
            <bdi dir="ltr">--{name}</bdi>
          </dt>
        </div>
      ))}
    </dl>
  );
}
