"use client";
import {
  createContext,
  useContext,
  useId,
  useState,
  type ReactElement,
} from "react";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { cn } from "@/lib/utils";

function TooltipProvider({
  delay = 0,
  ...props
}: TooltipPrimitive.Provider.Props): ReactElement {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delay={delay}
      {...props}
    />
  );
}

const TooltipContext = createContext({ id: "", open: false });
function Tooltip({
  open,
  defaultOpen = false,
  onOpenChange,
  ...props
}: TooltipPrimitive.Root.Props): ReactElement {
  const id = useId();
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const visible = open ?? internalOpen;
  return (
    <TooltipContext.Provider value={{ id, open: visible }}>
      <TooltipPrimitive.Root
        data-slot="tooltip"
        open={visible}
        onOpenChange={(next, event) => {
          setInternalOpen(next);
          onOpenChange?.(next, event);
        }}
        {...props}
      />
    </TooltipContext.Provider>
  );
}

function TooltipTrigger({
  ...props
}: TooltipPrimitive.Trigger.Props): ReactElement {
  const tooltip = useContext(TooltipContext);
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      aria-describedby={tooltip.open ? tooltip.id : undefined}
      {...props}
    />
  );
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >): ReactElement {
  const tooltip = useContext(TooltipContext);
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          id={tooltip.id}
          role="tooltip"
          className={cn(
            "z-50 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-2 rounded-md transition-opacity duration-standard ease-standard data-starting-style:opacity-0 data-ending-style:opacity-0 bg-foreground ps-3 pe-3 py-1.5 text-caption text-background has-data-[slot=kbd]:pe-2 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm",
            className,
          )}
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground data-[side=bottom]:top-1 data-[side=inline-end]:top-1/2! data-[side=inline-end]:-start-1 data-[side=inline-end]:-translate-y-1/2 data-[side=inline-start]:top-1/2! data-[side=inline-start]:-end-1 data-[side=inline-start]:-translate-y-1/2 data-[side=top]:-bottom-2.5" />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
