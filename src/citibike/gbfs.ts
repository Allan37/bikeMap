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
  num_docks_available: number;
  is_renting: number; // GBFS booleans are 0/1
  is_returning: number;
}

export async function fetchStationInformation(): Promise<StationInfo[]> {
  const response = await fetch(STATION_INFORMATION_URL);
  if (!response.ok) {
    throw new Error(`station_information fetch failed: ${response.status}`);
  }
  const body = (await response.json()) as { data: { stations: RawStationInformation[] } };
  return body.data.stations.map((s) => ({
    stationId: s.station_id,
    name: s.name,
    lat: s.lat,
    lon: s.lon,
    capacity: s.capacity,
  }));
}

export async function fetchStationStatus(): Promise<StationStatus[]> {
  const response = await fetch(STATION_STATUS_URL);
  if (!response.ok) {
    throw new Error(`station_status fetch failed: ${response.status}`);
  }
  const body = (await response.json()) as { data: { stations: RawStationStatus[] } };
  return body.data.stations.map((s) => ({
    stationId: s.station_id,
    bikesAvailable: s.num_bikes_available,
    docksAvailable: s.num_docks_available,
    isRenting: s.is_renting === 1,
    isReturning: s.is_returning === 1,
  }));
}

/** Join static station info with the latest live status by station_id. */
export function mergeStations(info: StationInfo[], status: StationStatus[]): Station[] {
  const statusById = new Map(status.map((s) => [s.stationId, s]));
  return info.map((s) => ({
    ...s,
    status: statusById.get(s.stationId) ?? null,
  }));
}
