import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

/** A hint for a value: keeps the reason reachable as `data-reason`, by keyboard and in a tooltip. */
export function Reason({
  reason,
  children,
  focusable = true,
}: {
  reason: string | null | undefined;
  children: ReactNode;
  /** False inside a button or link, which is already one focus stop. */
  focusable?: boolean;
}) {
  if (!reason) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            data-reason={reason}
            aria-description={reason}
            tabIndex={focusable ? 0 : undefined}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}
