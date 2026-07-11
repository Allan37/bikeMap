import type { Feature, FeatureCollection, Point } from "geojson";
import type { DataDrivenPropertyValueSpecification, ExpressionSpecification, FilterSpecification } from "mapbox-gl";
import { haversineDistanceMeters } from "../routing/scoring";
import type { Coordinates, Station } from "../types";

export const STATION_SOURCE_ID = "citibike-stations";
export const STATION_LAYER_ID = "citibike-stations-layer";
export const STATION_LABEL_PRIORITY_LAYER_ID = "citibike-station-labels-priority";
export const STATION_LABEL_NORMAL_LAYER_ID = "citibike-station-labels-normal";

// A station within this distance of your location or destination is close enough to matter, so its
// count label appears earlier (at a lower zoom) than the rest.
const NEAR_RADIUS_METERS = 400;
export const PRIORITY_LABEL_MINZOOM = 13;
export const NORMAL_LABEL_MINZOOM = 15;

export interface StationProperties {
  stationId: string;
  name: string;
  bikesAvailable: number;
  ebikesAvailable: number;
  docksAvailable: number;
  // Mapbox GL data-driven styling needs a flat scalar to branch on.
  availability: "bikes" | "docks-only" | "dead" | "unknown";
  // Near your location → grab-a-bike context (show bikes); near your destination → parking context
  // (show open docks). Both get the earlier, lower-zoom label.
  nearUser: boolean;
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
  const features: Feature<Point, StationProperties>[] = stations.map((s) => {
    const here: Coordinates = { lat: s.lat, lon: s.lon };
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.lon, s.lat] },
      properties: {
        stationId: s.stationId,
        name: s.name,
        bikesAvailable: s.status?.bikesAvailable ?? 0,
        ebikesAvailable: s.status?.ebikesAvailable ?? 0,
        docksAvailable: s.status?.docksAvailable ?? 0,
        availability: availabilityFor(s),
        nearUser: userLocation ? haversineDistanceMeters(userLocation, here) <= NEAR_RADIUS_METERS : false,
        nearDestination: destination ? haversineDistanceMeters(destination, here) <= NEAR_RADIUS_METERS : false,
      },
    };
  });
  return { type: "FeatureCollection", features };
}

/** Label text: open docks ("12 P") near the destination — where you park — else the bike count. */
export const STATION_LABEL_TEXT_FIELD: ExpressionSpecification = [
  "case",
  ["get", "nearDestination"],
  ["concat", ["to-string", ["get", "docksAvailable"]], " P"],
  ["to-string", ["get", "bikesAvailable"]],
];

// Only label stations with real data (dead stations already carry a ✕; skip unknown/no-data).
const HAS_DATA: FilterSpecification = ["match", ["get", "availability"], ["bikes", "docks-only"], true, false];
const IS_NEAR: FilterSpecification = ["any", ["get", "nearUser"], ["get", "nearDestination"]];
export const STATION_LABEL_PRIORITY_FILTER: FilterSpecification = ["all", HAS_DATA, IS_NEAR];
export const STATION_LABEL_NORMAL_FILTER: FilterSpecification = ["all", HAS_DATA, ["!", IS_NEAR]];

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
