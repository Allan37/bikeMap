import { useCallback, useEffect, useRef, useState } from "react";
import { STATION_STATUS_POLL_INTERVAL_ACTIVE_MS, STATION_STATUS_POLL_INTERVAL_IDLE_MS } from "../config";
import type { Station, StationInfo } from "../types";
import { fetchStationInformation, fetchStationStatus, mergeStations } from "./gbfs";

interface UseStationsResult {
  stations: Station[];
  lastUpdated: Date | null;
  error: string | null;
}

/**
 * Loads static station info once, then polls live status on an interval and re-merges.
 * `isActive` (destination + user location both set — about to depart) tightens the poll
 * interval toward the source's real refresh ceiling; see config.ts for why.
 */
export function useStations(isActive: boolean): UseStationsResult {
  const [stations, setStations] = useState<Station[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const infoRef = useRef<StationInfo[]>([]);
  const infoPromiseRef = useRef<Promise<StationInfo[]> | null>(null);

  /** Shares a successful static-data request, but clears a failed one so the next poll retries it. */
  const getStationInformation = useCallback((): Promise<StationInfo[]> => {
    if (infoRef.current.length > 0) return Promise.resolve(infoRef.current);
    if (!infoPromiseRef.current) {
      infoPromiseRef.current = fetchStationInformation()
        .then((info) => {
          infoRef.current = info;
          return info;
        })
        .catch((error: unknown) => {
          infoPromiseRef.current = null;
          throw error;
        });
    }
    return infoPromiseRef.current;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let statusController: AbortController | null = null;

    async function pollStatus() {
      // setInterval does not wait for an async request. Skip a tick rather than downloading
      // concurrent copies of the same ~1 MB status feed on a slow mobile connection.
      if (inFlight) return;
      inFlight = true;
      statusController = new AbortController();
      try {
        await getStationInformation(); // no-op once static data is already available
        const snapshot = await fetchStationStatus(statusController.signal);
        if (cancelled) return;
        setStations(mergeStations(infoRef.current, snapshot.stations));
        setLastUpdated(snapshot.lastUpdated ?? new Date());
        setError(null);
      } catch (err) {
        // Effect cleanup aborts an obsolete poll; that is not a user-visible station-data error.
        if (!cancelled && !(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof Error ? err.message : "Citibike data request failed");
        }
      } finally {
        inFlight = false;
        statusController = null;
      }
    }

    // Poll immediately on (re)start — e.g. so going active gets a fresh snapshot right away
    // rather than waiting up to a full idle-interval for the next scheduled tick.
    pollStatus();
    const intervalMs = isActive ? STATION_STATUS_POLL_INTERVAL_ACTIVE_MS : STATION_STATUS_POLL_INTERVAL_IDLE_MS;
    const intervalId = setInterval(pollStatus, intervalMs);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      statusController?.abort();
    };
  }, [isActive, getStationInformation]);

  return { stations, lastUpdated, error };
}
