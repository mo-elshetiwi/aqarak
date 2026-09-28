import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
interface HeaderAction {
  label: string;
  onClick: () => void;
}
export interface PageHeaderProps {
  title: string;
  description?: string;
  primaryAction?: HeaderAction;
  secondaryAction?: HeaderAction;
}
/** A page owns one title and at most one action of each priority. */
export function PageHeader({
  title,
  description,
  primaryAction,
  secondaryAction,
}: PageHeaderProps): ReactElement {
  return (
    <header className="flex flex-wrap items-start justify-between gap-6">
      <div className="space-y-2">
        <h1 className="text-h1">{title}</h1>
        {description && (
          <p className="text-body text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="flex gap-2">
        {secondaryAction && (
          <Button variant="secondary" onClick={secondaryAction.onClick}>
            {secondaryAction.label}
          </Button>
        )}
        {primaryAction && (
          <Button onClick={primaryAction.onClick}>{primaryAction.label}</Button>
        )}
      </div>
    </header>
  );
}
