import { createContext, useContext, type ReactNode } from "react";
import { cn } from "../lib/utils";

/**
 * What the shell hands to whichever view is showing: the connection chip (appended to the header
 * actions), the stale flag (greys the content) and the reconnect notice (above the content).
 * Views rendered outside the shell, for example in specs, see the empty default.
 */
export const ShellContext = createContext<{
  chip?: ReactNode;
  stale?: boolean;
  notice?: ReactNode;
}>({});

export const PANEL_TITLE_CLASS =
  "select-none text-2xl font-semibold tracking-tight";

/** Panel header + content, adapted from Motrix desktop-kit/panel/panel-shell.tsx (MIT). */
export function PanelShell({
  title,
  titleId,
  actions,
  headerClassName,
  contentClassName,
  children,
}: {
  title: string;
  titleId: string;
  actions?: ReactNode;
  headerClassName?: string;
  contentClassName?: string;
  children: ReactNode;
}) {
  const { chip, stale, notice } = useContext(ShellContext);
  return (
    <section
      aria-labelledby={titleId}
      className="relative flex h-full min-h-0 flex-col"
    >
      <header
        data-slot="panel-shell-header"
        className={cn(
          "flex shrink-0 items-center justify-between gap-4 px-6 pt-8 pb-3",
          headerClassName,
        )}
      >
        <div className="shrink-0">
          <h1 id={titleId} className={PANEL_TITLE_CLASS}>
            {title}
          </h1>
        </div>
        <div
          data-slot="panel-shell-actions"
          className="app-no-drag relative z-40 flex min-h-9 shrink-0 items-center gap-2"
        >
          {actions}
          {chip}
        </div>
      </header>
      {notice}
      <div
        data-slot="panel-shell-content"
        data-stale={stale ? "" : undefined}
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-auto px-6 pb-6 data-stale:opacity-[.64] data-stale:grayscale",
          contentClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}
