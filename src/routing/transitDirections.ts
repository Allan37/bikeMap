import type { Coordinates } from "../types";

export interface TransitStep {
  kind: "walk" | "transit";
  durationSeconds: number;
  instruction?: string;
  line?: string;
  lineColor?: string | null;
  vehicle?: string;
  headsign?: string;
  departureStop?: string;
  arrivalStop?: string;
  numStops?: number;
  /** Stop coordinates (transit steps) — the multimodal planner bikes to departureCoords. */
  departureCoords?: Coordinates | null;
  arrivalCoords?: Coordinates | null;
  /** Google-encoded polyline for this step, so routes can be drawn on the map. */
  polyline?: string | null;
}

/** Decodes a Google encoded polyline into GeoJSON-ordered [lon, lat] pairs. */
export function decodePolyline(encoded: string): [number, number][] {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coordinates: [number, number][] = [];
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coordinates.push([lng / 1e5, lat / 1e5]);
  }
  return coordinates;
}

export interface TransitRoute {
  totalDurationSeconds: number;
  departureText?: string | null;
  arrivalText?: string | null;
  steps: TransitStep[];
}

/** Calls our own /api/transit-directions proxy (never Google directly — the key isn't client-safe). */
export async function fetchTransitRoute(origin: Coordinates, destination: Coordinates): Promise<TransitRoute | null> {
  const params = new URLSearchParams({
    originLat: String(origin.lat),
    originLon: String(origin.lon),
    destLat: String(destination.lat),
    destLon: String(destination.lon),
  });
  const response = await fetch(`/api/transit-directions?${params}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Transit directions failed: ${response.status}`);
  }
  const body = (await response.json()) as { route: TransitRoute | null };
  return body.route;
}
