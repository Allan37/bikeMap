import type { Feature, FeatureCollection, LineString } from "geojson";
import type { RouteOption } from "../types";

export const ROUTE_SOURCE_ID = "selected-route";
export const ROUTE_LAYER_ID = "selected-route-layer";

interface RouteLegProperties {
  mode: "walk" | "bike";
  estimated: boolean;
}

/**
 * Builds line features for a selected route's three legs. The bike leg falls back to a
 * straight line between the two stations when it's still an unrefined estimate (no real
 * routed geometry yet) — see routing/candidateSearch.refineWithRealBikeRoute.
 */
export function routeOptionToGeoJSON(option: RouteOption): FeatureCollection<LineString, RouteLegProperties> {
  const features: Feature<LineString, RouteLegProperties>[] = [];

  if (option.walkToStation.geometry) {
    features.push({ type: "Feature", geometry: option.walkToStation.geometry, properties: { mode: "walk", estimated: false } });
  }

  features.push({
    type: "Feature",
    geometry:
      option.bikeLeg.geometry ??
      {
        type: "LineString",
        coordinates: [
          [option.originStation.lon, option.originStation.lat],
          [option.destinationStation.lon, option.destinationStation.lat],
        ],
      },
    properties: { mode: "bike", estimated: option.bikeLeg.estimated },
  });

  if (option.walkFromStation.geometry) {
    features.push({ type: "Feature", geometry: option.walkFromStation.geometry, properties: { mode: "walk", estimated: false } });
  }

  return { type: "FeatureCollection", features };
}

export const EMPTY_ROUTE_GEOJSON: FeatureCollection<LineString, RouteLegProperties> = { type: "FeatureCollection", features: [] };
