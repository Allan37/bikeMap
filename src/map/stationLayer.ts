import type { Feature, FeatureCollection, Point } from "geojson";
import type { DataDrivenPropertyValueSpecification } from "mapbox-gl";
import type { Station } from "../types";

export const STATION_SOURCE_ID = "citibike-stations";
export const STATION_LAYER_ID = "citibike-stations-layer";

export interface StationProperties {
  stationId: string;
  name: string;
  bikesAvailable: number;
  docksAvailable: number;
  // Mapbox GL data-driven styling needs a flat scalar to branch on.
  availability: "bikes" | "docks-only" | "empty" | "unknown";
}

function availabilityFor(station: Station): StationProperties["availability"] {
  if (!station.status) return "unknown";
  if (station.status.bikesAvailable > 0) return "bikes";
  if (station.status.docksAvailable > 0) return "docks-only";
  return "empty";
}

export function stationsToGeoJSON(stations: Station[]): FeatureCollection<Point, StationProperties> {
  const features: Feature<Point, StationProperties>[] = stations.map((s) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [s.lon, s.lat] },
    properties: {
      stationId: s.stationId,
      name: s.name,
      bikesAvailable: s.status?.bikesAvailable ?? 0,
      docksAvailable: s.status?.docksAvailable ?? 0,
      availability: availabilityFor(s),
    },
  }));
  return { type: "FeatureCollection", features };
}

/** Color stations green (has bikes), amber (docks only, no bikes), red (full/empty), gray (no data yet). */
export const STATION_CIRCLE_COLOR: DataDrivenPropertyValueSpecification<string> = [
  "match",
  ["get", "availability"],
  "bikes",
  "#2e7d32",
  "docks-only",
  "#f9a825",
  "empty",
  "#c62828",
  "#9e9e9e",
];
