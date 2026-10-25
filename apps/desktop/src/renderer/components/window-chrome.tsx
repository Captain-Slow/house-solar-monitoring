import { useEffect, useState } from "react";
import { Sun } from "lucide-react";
import { cn } from "../lib/utils";

type CaptionIconName = "close" | "maximize" | "minimize" | "restore";

// Adapted from Motrix components/window-chrome/window-chrome.tsx (MIT).
function CaptionIcon({ name }: { name: CaptionIconName }) {
  return (
    <svg
      aria-hidden
      className="size-2.5"
      data-caption-icon={name}
      viewBox="0 0 10 10"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {name === "minimize" && <path d="M0 5h10v1H0z" fill="currentColor" />}
      {name === "maximize" && (
        <rect
          x="0.5"
          y="0.5"
          width="9"
          height="9"
          rx="1.5"
          stroke="currentColor"
        />
      )}
      {name === "restore" && (
        <>
          <path
            d="M2.5 2V1.5a1 1 0 0 1 1-1h4a2 2 0 0 1 2 2v4a1 1 0 0 1-1 1H8"
            stroke="currentColor"
          />
          <rect
            x="0.5"
            y="2.5"
            width="7"
            height="7"
            rx="1"
            stroke="currentColor"
          />
        </>
      )}
      {name === "close" && (
        <path
          d="m0.5 0.5 9 9m0-9-9 9"
          stroke="currentColor"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

const buttonClassName =
  "app-no-drag flex size-7 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-foreground outline-none transition-colors [&>svg]:opacity-65 hover:[&>svg]:opacity-90 focus-visible:[&>svg]:opacity-90 focus-visible:ring-2 focus-visible:ring-ring";

function DesktopWindowControls() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => window.solar.window.onMaximizedChanged(setMaximized), []);
  const label = maximized ? "Restore" : "Maximize";
  return (
    <div
      data-slot="desktop-window-controls"
      className="flex shrink-0 items-center gap-2 pe-3.5 pt-3.5"
    >
      <button
        type="button"
        className={cn(buttonClassName, "hover:bg-accent")}
        aria-label="Minimize"
        onClick={() => void window.solar.window.minimize()}
      >
        <CaptionIcon name="minimize" />
      </button>
      <button
        type="button"
        className={cn(buttonClassName, "hover:bg-accent")}
        aria-label={label}
        onClick={() => void window.solar.window.toggleMaximize()}
      >
        <CaptionIcon name={maximized ? "restore" : "maximize"} />
      </button>
      <button
        type="button"
        className={cn(
          buttonClassName,
          "hover:bg-destructive hover:text-white hover:[&>svg]:opacity-100",
        )}
        aria-label="Close"
        onClick={() => void window.solar.window.close()}
      >
        <CaptionIcon name="close" />
      </button>
    </div>
  );
}

/** The 40px drag strip over the window: wordmark on the left, caption buttons on the right. */
export function WindowChrome() {
  return (
    <div
      data-slot="window-chrome"
      className="app-drag fixed top-0 right-0 left-0 z-30 flex h-10 items-center justify-between bg-transparent select-none"
    >
      <div className="app-no-drag flex h-7 items-center gap-1.5 ps-[18px] pt-3.5 text-sm font-semibold text-sidebar-foreground">
        <Sun aria-hidden className="size-4" />
        <span>Solar</span>
      </div>
      <DesktopWindowControls />
    </div>
  );
}
