import type { Feature, FeatureCollection, LineString } from "geojson";
import { decodePolyline, type TransitRoute } from "../routing/transitDirections";
import type { RouteOption } from "../types";

export const ROUTE_SOURCE_ID = "selected-route";
export const ROUTE_LAYER_ID = "selected-route-layer";
export const ROUTE_CASING_LAYER_ID = "selected-route-casing";

export interface RouteLegProperties {
  mode: "walk" | "bike" | "transit";
  estimated: boolean;
  /** Transit legs only: the line's brand color (e.g. MTA red for the 1). */
  lineColor?: string;
}

export type RouteGeoJSON = FeatureCollection<LineString, RouteLegProperties>;

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

/** Line features for a transit route — decoded step polylines, colored by line for train legs. */
export function transitRouteToGeoJSON(route: TransitRoute): RouteGeoJSON {
  const features: Feature<LineString, RouteLegProperties>[] = [];
  for (const step of route.steps) {
    if (!step.polyline) continue;
    const coordinates = decodePolyline(step.polyline);
    if (coordinates.length < 2) continue;
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates },
      properties:
        step.kind === "transit"
          ? { mode: "transit", estimated: false, lineColor: step.lineColor ?? "#555555" }
          : { mode: "walk", estimated: false },
    });
  }
  return { type: "FeatureCollection", features };
}

/** Bike leg + train legs stitched into one drawable trip. */
export function combineRouteGeoJSON(a: RouteGeoJSON, b: RouteGeoJSON): RouteGeoJSON {
  return { type: "FeatureCollection", features: [...a.features, ...b.features] };
}

export const EMPTY_ROUTE_GEOJSON: RouteGeoJSON = { type: "FeatureCollection", features: [] };
