import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { OperationName, QueryError } from "@solar/contracts/bridge";
import type { MeterReadingsQuery } from "@solar/contracts/generated/graphql";
import { useConnectionEpoch } from "./connection-scope";

export class SolarQueryError extends Error {
  constructor(readonly detail: QueryError) {
    super(detail.message);
  }
}

export async function solarQuery<T>(
  name: OperationName,
  vars?: Record<string, unknown>,
): Promise<T> {
  const response = await window.solar.query<T>(name, vars);
  if (!response.ok) throw new SolarQueryError(response.error);
  return response.data;
}

/** Cache key of one operation within one backend connection epoch (see connection-scope.tsx). */
export function solarQueryKey(
  name: OperationName,
  vars?: Record<string, unknown>,
  epoch = 0,
): readonly [OperationName, Record<string, unknown> | undefined, number] {
  return [name, vars, epoch];
}

export function useSolarQuery<T>(
  name: OperationName,
  vars?: Record<string, unknown>,
  interval?: number,
  enabled = true,
) {
  const epoch = useConnectionEpoch();
  return useQuery<T>({
    queryKey: solarQueryKey(name, vars, epoch),
    queryFn: () => solarQuery<T>(name, vars),
    refetchInterval: interval,
    enabled,
    retry: false,
  });
}

export type MeterReadingNode =
  MeterReadingsQuery["meterReadings"]["edges"][number]["node"];

export interface MeterReadingsPages {
  /** All readings loaded so far, in the backend's ascending id order. */
  readings: MeterReadingNode[];
  /** The first page has loaded. */
  loaded: boolean;
  hasMore: boolean;
  fetching: boolean;
  loadingMore: boolean;
  error: Error | null;
  loadMore(): void;
}

const METER_READINGS_PAGE_SIZE = 50;

/** Meter readings are paged with the API's cursor; every reading is reachable by loading further pages. */
export function useMeterReadings(): MeterReadingsPages {
  const epoch = useConnectionEpoch();
  const query = useInfiniteQuery({
    queryKey: [
      ...solarQueryKey(
        "MeterReadings",
        { first: METER_READINGS_PAGE_SIZE },
        epoch,
      ),
      "pages",
    ],
    queryFn: ({ pageParam }) =>
      solarQuery<MeterReadingsQuery>("MeterReadings", {
        first: METER_READINGS_PAGE_SIZE,
        after: pageParam,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      last.meterReadings.pageInfo.hasNextPage
        ? last.meterReadings.pageInfo.endCursor
        : undefined,
    retry: false,
  });
  return {
    readings:
      query.data?.pages.flatMap((page) =>
        page.meterReadings.edges.map((edge) => edge.node),
      ) ?? [],
    loaded: query.data !== undefined,
    hasMore: query.hasNextPage,
    fetching: query.isFetching,
    loadingMore: query.isFetchingNextPage,
    error: query.error,
    loadMore: () => {
      if (query.isFetching || !query.hasNextPage) return;
      void query.fetchNextPage({ cancelRefetch: false });
    },
  };
}
