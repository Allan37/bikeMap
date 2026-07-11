import { useEffect, useRef, useState } from "react";
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
  // Lazily created once and reused across re-renders/effect restarts — station info is
  // fetched exactly once regardless of how many times `isActive` toggles.
  const infoPromiseRef = useRef<Promise<StationInfo[]> | null>(null);
  if (!infoPromiseRef.current) {
    infoPromiseRef.current = fetchStationInformation().then((info) => {
      infoRef.current = info;
      return info;
    });
  }

  useEffect(() => {
    let cancelled = false;

    async function pollStatus() {
      try {
        await infoPromiseRef.current; // no-op once already resolved
        const status = await fetchStationStatus();
        if (cancelled) return;
        setStations(mergeStations(infoRef.current, status));
        setLastUpdated(new Date());
        setError(null);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
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
    };
  }, [isActive]);

  return { stations, lastUpdated, error };
}
