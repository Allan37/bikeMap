import type { Feature, FeatureCollection, Point } from "geojson";
import type { DataDrivenPropertyValueSpecification, ExpressionSpecification, FilterSpecification } from "mapbox-gl";
import { haversineDistanceMeters } from "../routing/scoring";
import type { Coordinates, Station } from "../types";

export const STATION_SOURCE_ID = "citibike-stations";
export const STATION_LAYER_ID = "citibike-stations-layer";
// Number drawn inside the (enlarged) dot once zoomed in; external number offset above the dot for
// the few nearest stations when zoomed out; detailed manual/electric/docks breakdown when very close.
export const STATION_LABEL_INSIDE_LAYER_ID = "citibike-station-labels-inside";
export const STATION_LABEL_EXTERNAL_LAYER_ID = "citibike-station-labels-external";
export const STATION_LABEL_DETAIL_LAYER_ID = "citibike-station-labels-detail";

// From this zoom the dots are big enough to hold a count, so every station shows its number inside.
export const INSIDE_LABEL_MINZOOM = 14;
// Zoomed in this far, the count breaks out into manual / electric / open docks.
export const DETAIL_LABEL_MINZOOM = 17;
// How many of the closest-to-you stations get an external number when zoomed out past the inside tier.
const NEAREST_LABEL_COUNT = 3;
// A station within this distance of the destination shows open docks (parking) rather than bikes.
const NEAR_DESTINATION_METERS = 400;

export interface StationProperties {
  stationId: string;
  name: string;
  bikesAvailable: number;
  ebikesAvailable: number;
  docksAvailable: number;
  // Mapbox GL data-driven styling needs a flat scalar to branch on.
  availability: "bikes" | "docks-only" | "dead" | "unknown";
  // One of the few closest stations to you — gets an external number even when zoomed out.
  nearestToUser: boolean;
  // Near the destination → show open docks (where you park) instead of bikes.
  nearDestination: boolean;
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
  // The N stations physically closest to you — labeled externally when zoomed out.
  const nearestIds = new Set<string>(
    userLocation
      ? stations
          .map((s) => ({ id: s.stationId, d: haversineDistanceMeters(userLocation, { lat: s.lat, lon: s.lon }) }))
          .sort((a, b) => a.d - b.d)
          .slice(0, NEAREST_LABEL_COUNT)
          .map((x) => x.id)
      : [],
  );

  const features: Feature<Point, StationProperties>[] = stations.map((s) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [s.lon, s.lat] },
    properties: {
      stationId: s.stationId,
      name: s.name,
      bikesAvailable: s.status?.bikesAvailable ?? 0,
      ebikesAvailable: s.status?.ebikesAvailable ?? 0,
      docksAvailable: s.status?.docksAvailable ?? 0,
      availability: availabilityFor(s),
      nearestToUser: nearestIds.has(s.stationId),
      nearDestination: destination
        ? haversineDistanceMeters(destination, { lat: s.lat, lon: s.lon }) <= NEAR_DESTINATION_METERS
        : false,
    },
  }));
  return { type: "FeatureCollection", features };
}

/** Label text: open docks ("12P") near the destination — where you park — else the bike count. */
export const STATION_LABEL_TEXT_FIELD: ExpressionSpecification = [
  "case",
  ["get", "nearDestination"],
  ["concat", ["to-string", ["get", "docksAvailable"]], "P"],
  ["to-string", ["get", "bikesAvailable"]],
];

/** Detailed breakdown, e.g. "3m 2e 8p" — manual bikes, e-bikes, open docks (parking). */
export const STATION_LABEL_DETAIL_TEXT_FIELD: ExpressionSpecification = [
  "concat",
  ["to-string", ["-", ["get", "bikesAvailable"], ["get", "ebikesAvailable"]]],
  "m  ",
  ["to-string", ["get", "ebikesAvailable"]],
  "e  ",
  ["to-string", ["get", "docksAvailable"]],
  "p",
];

// Only label stations with real data (dead stations already carry a ✕; skip unknown/no-data).
const HAS_DATA: FilterSpecification = ["match", ["get", "availability"], ["bikes", "docks-only"], true, false];
export const STATION_LABEL_INSIDE_FILTER: FilterSpecification = HAS_DATA;
export const STATION_LABEL_DETAIL_FILTER: FilterSpecification = HAS_DATA;
export const STATION_LABEL_EXTERNAL_FILTER: FilterSpecification = [
  "all",
  HAS_DATA,
  ["any", ["get", "nearestToUser"], ["get", "nearDestination"]],
];

/** Dot radius — enlarged (roughly 2× the old sizes) so a count fits inside once zoomed in. */
export const STATION_CIRCLE_RADIUS: DataDrivenPropertyValueSpecification<number> = [
  "interpolate",
  ["linear"],
  ["zoom"],
  11,
  4,
  14,
  11,
  17,
  17,
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
