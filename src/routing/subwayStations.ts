import stationsData from "../data/subwayStations.json";
import type { Coordinates } from "../types";
import { haversineDistanceMeters } from "./scoring";

/** MTA subway stations (Manhattan/Brooklyn/Queens), bundled from the official stations dataset. */
export interface SubwayStation {
  name: string;
  lat: number;
  lon: number;
  /** Daytime routes served, e.g. ["E", "M"]. */
  lines: string[];
}

export const SUBWAY_STATIONS: SubwayStation[] = stationsData as SubwayStation[];

/** Stations whose straight-line distance from `point` is within [minMeters, maxMeters]. */
export function subwayStationsNear(point: Coordinates, minMeters: number, maxMeters: number): SubwayStation[] {
  return SUBWAY_STATIONS.filter((s) => {
    const d = haversineDistanceMeters(point, { lat: s.lat, lon: s.lon });
    return d >= minMeters && d <= maxMeters;
  });
}

/** Union of all lines served by stations within `radiusMeters` of `point`. */
export function subwayLinesNear(point: Coordinates, radiusMeters: number): Set<string> {
  const lines = new Set<string>();
  for (const s of subwayStationsNear(point, 0, radiusMeters)) {
    for (const line of s.lines) lines.add(line);
  }
  return lines;
}
