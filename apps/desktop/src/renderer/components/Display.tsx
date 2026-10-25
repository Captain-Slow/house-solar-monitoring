import type { ReactNode } from "react";
import type { ConnectionState } from "@solar/contracts/bridge";
import type { MeterReadingsPages } from "../api";
import { staleBanner } from "../models";
import { Button } from "./ui/button";
import { Reason } from "./ui/reason";

/**
 * A value with a trailing unit ("−1,600 W", "570.002 kWh") renders the unit smaller; the text
 * content stays identical. Values without a unit ("64%", "—") render whole.
 */
function splitUnit(text: string): { head: string; unit: string } | null {
  const at = text.lastIndexOf(" ");
  if (at < 0) return null;
  const unit = text.slice(at + 1);
  return /\d/.test(unit) ? null : { head: text.slice(0, at), unit };
}

export function Metric({
  label,
  text,
  reason,
  detail,
}: {
  label: string;
  text: string;
  reason?: string;
  detail?: ReactNode;
}) {
  const parts = splitUnit(text);
  // The number shrinks from 32px only when it would not fit the tile's width (e.g. 1,234,567.890).
  const digits = (parts ? parts.head : text).length;
  return (
    <div className="@container dashboard-tile flex min-h-0 flex-col gap-0 border-none p-4 shadow-md/5 transition-all">
      <dt className="text-[10px] leading-4 font-medium tracking-[0.04em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd
        className="mt-2 text-[32px] leading-none font-semibold tabular-nums"
        style={{
          fontSize: `min(32px, calc(100cqw / ${(digits * 0.62).toFixed(2)}))`,
        }}
      >
        <Reason reason={reason}>
          {parts ? (
            <>
              {parts.head}{" "}
              <span className="text-xs font-normal">{parts.unit}</span>
            </>
          ) : (
            text
          )}
        </Reason>
        {detail && (
          <span className="mt-2 block text-xs leading-4 font-normal break-words text-muted-foreground">
            {detail}
          </span>
        )}
      </dd>
    </div>
  );
}

export function Message({ children }: { children: ReactNode }) {
  return (
    <p
      className="rounded-md border border-s-2 border-border border-s-amber-500 bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground"
      role="status"
    >
      {children}
    </p>
  );
}

/** Paging controls for the meter reading list: every reading is reachable by loading further pages. */
export function MeterReadingsPager({ pages }: { pages: MeterReadingsPages }) {
  return (
    <>
      <p className="text-xs text-muted-foreground">
        {pages.hasMore
          ? `${pages.readings.length} readings loaded; more are available.`
          : `All ${pages.readings.length} readings loaded.`}
      </p>
      {pages.error && <Message>{pages.error.message}</Message>}
      {pages.hasMore && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pages.fetching}
          onClick={pages.loadMore}
        >
          {pages.loadingMore ? "Loading readings…" : "Load more readings"}
        </Button>
      )}
    </>
  );
}

export function ConnectionNotice({
  state,
  lastData,
  now,
  serverAgeSeconds,
  elapsedSeconds,
}: {
  state: ConnectionState;
  lastData: string | null;
  now: number;
  serverAgeSeconds?: number | null;
  elapsedSeconds?: number;
}) {
  if (state.kind !== "RECONNECTING") return null;
  return (
    <div
      data-slot="connection-notice"
      className="flex shrink-0 items-center justify-between gap-3 rounded-md border border-border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground"
      role="status"
    >
      {staleBanner(
        state.since,
        lastData,
        now,
        serverAgeSeconds,
        elapsedSeconds,
      )}
    </div>
  );
}
