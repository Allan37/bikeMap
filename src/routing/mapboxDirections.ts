import { MAPBOX_TOKEN } from "../config";
import type { Coordinates, RouteLeg } from "../types";

const DIRECTIONS_BASE_URL = "https://api.mapbox.com/directions/v5/mapbox";

interface RawDirectionsResponse {
  routes: Array<{
    duration: number;
    distance: number;
    geometry: GeoJSON.LineString;
  }>;
}

async function fetchRoute(profile: "walking" | "cycling", from: Coordinates, to: Coordinates): Promise<RouteLeg> {
  const coords = `${from.lon},${from.lat};${to.lon},${to.lat}`;
  const params = new URLSearchParams({
    geometries: "geojson",
    overview: "full",
    access_token: MAPBOX_TOKEN,
  });
  const response = await fetch(`${DIRECTIONS_BASE_URL}/${profile}/${coords}?${params}`);
  if (!response.ok) {
    throw new Error(`Directions (${profile}) failed: ${response.status}`);
  }
  const body = (await response.json()) as RawDirectionsResponse;
  const route = body.routes?.[0];
  if (!route) {
    throw new Error(`No ${profile} route found`);
  }
  return {
    mode: profile === "walking" ? "walk" : "bike",
    durationSeconds: route.duration,
    distanceMeters: route.distance,
    geometry: route.geometry,
    estimated: false,
  };
}

export function getWalkingRoute(from: Coordinates, to: Coordinates): Promise<RouteLeg> {
  return fetchRoute("walking", from, to);
}

export function getCyclingRoute(from: Coordinates, to: Coordinates): Promise<RouteLeg> {
  return fetchRoute("cycling", from, to);
}
