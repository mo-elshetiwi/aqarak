"use client";
import type { ReactElement, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
export function ReviewIconButton({
  label,
  children,
  onClick,
  disabled = false,
  describedBy,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  describedBy?: string | undefined;
}): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            disabled={disabled}
            aria-describedby={describedBy}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
