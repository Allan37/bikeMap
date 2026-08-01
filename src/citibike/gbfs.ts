import { STATION_INFORMATION_URL, STATION_STATUS_URL } from "../config";
import type { Station, StationInfo, StationStatus } from "../types";

interface RawStationInformation {
  station_id: string;
  name: string;
  lat: number;
  lon: number;
  capacity: number;
}

interface RawStationStatus {
  station_id: string;
  num_bikes_available: number;
  num_ebikes_available: number;
  num_docks_available: number;
  is_renting: number; // GBFS booleans are 0/1
  is_returning: number;
}

interface RawGbfsResponse<T> {
  last_updated?: number;
  data: T;
}

export interface StationStatusSnapshot {
  stations: StationStatus[];
  /** Timestamp supplied by Citibike/Lyft, rather than the time this phone happened to download it. */
  lastUpdated: Date | null;
}

const GBFS_REQUEST_TIMEOUT_MS = 12_000;

async function fetchGbfs(url: string, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), GBFS_REQUEST_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) {
      throw new Error("Citibike request timed out");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function fetchStationInformation(): Promise<StationInfo[]> {
  const response = await fetchGbfs(STATION_INFORMATION_URL);
  if (!response.ok) {
    throw new Error(`station_information fetch failed: ${response.status}`);
  }
  const body = (await response.json()) as RawGbfsResponse<{ stations: RawStationInformation[] }>;
  return body.data.stations.map((s) => ({
    stationId: s.station_id,
    name: s.name,
    lat: s.lat,
    lon: s.lon,
    capacity: s.capacity,
  }));
}

export async function fetchStationStatus(signal?: AbortSignal): Promise<StationStatusSnapshot> {
  const response = await fetchGbfs(STATION_STATUS_URL, signal);
  if (!response.ok) {
    throw new Error(`station_status fetch failed: ${response.status}`);
  }
  const body = (await response.json()) as RawGbfsResponse<{ stations: RawStationStatus[] }>;
  return {
    stations: body.data.stations.map((s) => ({
    stationId: s.station_id,
    bikesAvailable: s.num_bikes_available,
    ebikesAvailable: s.num_ebikes_available,
    docksAvailable: s.num_docks_available,
    isRenting: s.is_renting === 1,
    isReturning: s.is_returning === 1,
    })),
    lastUpdated: typeof body.last_updated === "number" ? new Date(body.last_updated * 1000) : null,
  };
}

/** Join static station info with the latest live status by station_id. */
export function mergeStations(info: StationInfo[], status: StationStatus[]): Station[] {
  const statusById = new Map(status.map((s) => [s.stationId, s]));
  return info.map((s) => ({
    ...s,
    status: statusById.get(s.stationId) ?? null,
  }));
}
