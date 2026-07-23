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
    throw new Error(`Transit directions failed: ${response.status}`);
  }
  const body = (await response.json()) as { route: TransitRoute | null };
  return body.route;
}
