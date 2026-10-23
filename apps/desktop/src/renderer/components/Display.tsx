import type { ReactNode } from "react";
import type { ConnectionState } from "@solar/contracts/bridge";
import type { MeterReadingsPages } from "../api";
import { staleBanner } from "../models";

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
  return (
    <div className="metric">
      <dt>{label}</dt>
      <dd title={reason ?? undefined}>
        {text}
        {detail && <span className="metric-detail">{detail}</span>}
      </dd>
    </div>
  );
}

export function Message({ children }: { children: ReactNode }) {
  return (
    <p className="message" role="status">
      {children}
    </p>
  );
}

/** Paging controls for the meter reading list: every reading is reachable by loading further pages. */
export function MeterReadingsPager({ pages }: { pages: MeterReadingsPages }) {
  return (
    <>
      <p className="meta">
        {pages.hasMore
          ? `${pages.readings.length} readings loaded; more are available.`
          : `All ${pages.readings.length} readings loaded.`}
      </p>
      {pages.error && <Message>{pages.error.message}</Message>}
      {pages.hasMore && (
        <button
          type="button"
          disabled={pages.fetching}
          onClick={pages.loadMore}
        >
          {pages.loadingMore ? "Loading readings…" : "Load more readings"}
        </button>
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
    <div className="notice" role="status">
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
