import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function DataTable({
  className,
  containerClassName,
  ...props
}: ComponentProps<"table"> & { containerClassName?: string }) {
  return (
    <div
      data-slot="data-table"
      className={cn(
        "overflow-x-auto rounded-lg border border-border",
        containerClassName,
      )}
    >
      <table className={cn("w-full text-xs", className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "sticky top-0 border-b border-border bg-background px-3 py-2 text-start text-[11px] leading-4 font-normal text-muted-foreground uppercase",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("px-3 py-2 align-middle", className)} {...props} />;
}

export function Tr({ className, ...props }: ComponentProps<"tr">) {
  return (
    <tr
      className={cn("border-b border-border last:border-b-0", className)}
      {...props}
    />
  );
}
