import type { ComponentProps } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

/**
 * A restyled native <select>. Data selectors stay native so `change` events and <option> elements
 * keep working in the specs; the open popup is drawn by the OS.
 */
export function NativeSelect({
  className,
  size = "default",
  ...props
}: Omit<ComponentProps<"select">, "size"> & { size?: "default" | "sm" }) {
  return (
    <div className="relative inline-flex">
      <select
        data-slot="native-select"
        data-size={size}
        className={cn(
          "h-9 w-full appearance-none rounded-md border border-input bg-input/30 ps-3 pe-9 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50",
          size === "sm" && "h-8",
          className,
        )}
        {...props}
      />
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}
