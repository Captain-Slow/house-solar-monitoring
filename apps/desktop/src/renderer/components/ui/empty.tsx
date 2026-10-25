import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

/** A whole view with nothing to show: 18px/500 title and a 14px muted hint (ref-08 "No downloads yet"). */
export function EmptyView({
  title,
  hint,
  className,
}: {
  title: string;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-1 text-center",
        className,
      )}
    >
      <p className="text-lg font-medium tracking-tight">{title}</p>
      {hint && <p className="text-sm text-foreground">{hint}</p>}
    </div>
  );
}

/** An empty list inside a tile: the dashed "No extensions connected yet." box (ref-02). */
export function EmptyList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "rounded border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground",
        className,
      )}
    >
      {children}
    </p>
  );
}
