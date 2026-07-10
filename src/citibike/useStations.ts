import { useEffect, useRef, useState } from "react";
import { STATION_STATUS_POLL_INTERVAL_MS } from "../config";
import type { Station, StationInfo } from "../types";
import { fetchStationInformation, fetchStationStatus, mergeStations } from "./gbfs";

interface UseStationsResult {
  stations: Station[];
  lastUpdated: Date | null;
  error: string | null;
}

/**
 * Loads static station info once, then polls live status on an interval and
 * re-merges. Station info rarely changes so it's not re-fetched on every poll.
 */
export function useStations(): UseStationsResult {
  const [stations, setStations] = useState<Station[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const infoRef = useRef<StationInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval>;

    async function pollStatus() {
      try {
        const status = await fetchStationStatus();
        if (cancelled) return;
        setStations(mergeStations(infoRef.current, status));
        setLastUpdated(new Date());
        setError(null);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    }

    async function init() {
      try {
        infoRef.current = await fetchStationInformation();
        await pollStatus();
        intervalId = setInterval(pollStatus, STATION_STATUS_POLL_INTERVAL_MS);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    }

    init();
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, []);

  return { stations, lastUpdated, error };
}
