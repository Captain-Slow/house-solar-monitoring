import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

/**
 * Capsule geometry for panel actions, adapted from Motrix desktop-kit/toolbar/toolbar-group.tsx (MIT).
 * Windows has no glass: this is the non-glass surface, with no backdrop-filter anywhere.
 */
export function ToolbarGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      {...props}
      className={cn(
        "toolbar-group app-no-drag flex h-9 shrink-0 items-center gap-1 rounded-full border border-border/70 bg-background/70 p-0.5",
        className,
      )}
    />
  );
}
