import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Every cached query belongs to one backend connection. The epoch is part of every query key (see
 * api.ts), so entries and failures of a previous backend can never be read as the current one's. It is a
 * plain counter: no backend address, token or other credential ever enters a cache key.
 */
const EpochContext = createContext(0);

export function useConnectionEpoch(): number {
  return useContext(EpochContext);
}

/**
 * The main process publishes NOT_CONFIGURED whenever the backend is forgotten or replaced (forget
 * connection, pinning another URL, a failed replacement). At that boundary requests still in flight
 * for the previous backend are cancelled, everything cached for it is dropped, and later queries move
 * to a new epoch, so even a response that still arrives can only land in a discarded entry.
 */
export function ConnectionScope({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [epoch, setEpoch] = useState(0);
  useEffect(
    () =>
      window.solar.onConnectionState((state) => {
        if (state.kind !== "NOT_CONFIGURED") return;
        void client.cancelQueries();
        client.removeQueries();
        setEpoch((current) => current + 1);
      }),
    [client],
  );
  return <EpochContext value={epoch}>{children}</EpochContext>;
}
