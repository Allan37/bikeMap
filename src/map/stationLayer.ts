import type { Feature, FeatureCollection, Point } from "geojson";
import type { DataDrivenPropertyValueSpecification } from "mapbox-gl";
import { haversineDistanceMeters } from "../routing/scoring";
import type { Coordinates, Station } from "../types";

export type StationMode = "bike" | "park";

export const STATION_SOURCE_ID = "citibike-stations";
export const STATION_LAYER_ID = "citibike-stations-layer";

// Stations are all-or-nothing: from this zoom, dots + count pills; below it, no indicators at all.
export const STATION_PILL_MINZOOM = 14;

// When a destination is selected, only this many stations near the start and near the destination
// are shown (the rest are cleared) — the relevant ones for the trip.
const NEAREST_ROUTING_COUNT = 5;

/** Station ids of the `n` stations closest to `point`. */
function nearestStationIds(stations: Station[], point: Coordinates, n: number): string[] {
  return stations
    .map((s) => ({ id: s.stationId, d: haversineDistanceMeters(point, { lat: s.lat, lon: s.lon }) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((x) => x.id);
}

export interface StationProperties {
  stationId: string;
  name: string;
  bikesAvailable: number;
  ebikesAvailable: number;
  docksAvailable: number;
  // Mapbox GL data-driven styling needs a flat scalar to branch on.
  availability: "bikes" | "docks-only" | "dead" | "unknown";
}

function availabilityFor(station: Station): StationProperties["availability"] {
  const status = station.status;
  if (!status) return "unknown";
  // Nothing to rent and nowhere to dock — the station is effectively out of service.
  if (status.bikesAvailable === 0 && status.docksAvailable === 0) return "dead";
  if (status.bikesAvailable > 0) return "bikes";
  return "docks-only";
}

export function stationsToGeoJSON(
  stations: Station[],
  userLocation?: Coordinates | null,
  destination?: Coordinates | null,
): FeatureCollection<Point, StationProperties> {
  // Once a trip is chosen, clear the clutter: show only the few stations near the start and near
  // the destination — those are the ones you'd actually use.
  let visible = stations;
  if (destination) {
    const keep = new Set<string>([
      ...(userLocation ? nearestStationIds(stations, userLocation, NEAREST_ROUTING_COUNT) : []),
      ...nearestStationIds(stations, destination, NEAREST_ROUTING_COUNT),
    ]);
    visible = stations.filter((s) => keep.has(s.stationId));
  }

  const features: Feature<Point, StationProperties>[] = visible.map((s) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [s.lon, s.lat] },
    properties: {
      stationId: s.stationId,
      name: s.name,
      bikesAvailable: s.status?.bikesAvailable ?? 0,
      ebikesAvailable: s.status?.ebikesAvailable ?? 0,
      docksAvailable: s.status?.docksAvailable ?? 0,
      availability: availabilityFor(s),
    },
  }));
  return { type: "FeatureCollection", features };
}

/** Dot radius — a small anchor under the HTML count pill (dots only exist at pill zooms). */
export const STATION_CIRCLE_RADIUS: DataDrivenPropertyValueSpecification<number> = [
  "interpolate",
  ["linear"],
  ["zoom"],
  14,
  7,
  17,
  8,
];

/** Color stations green (has bikes), amber (docks only, no bikes), near-black (dead: 0 bikes & 0 docks), gray (no data yet). */
export const STATION_CIRCLE_COLOR: DataDrivenPropertyValueSpecification<string> = [
  "match",
  ["get", "availability"],
  "bikes",
  "#2e7d32",
  "docks-only",
  "#f9a825",
  "dead",
  "#3a2020",
  "#9e9e9e",
];
