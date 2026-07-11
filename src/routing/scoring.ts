import type { Coordinates, RouteLeg } from "../types";

const EARTH_RADIUS_METERS = 6_371_000;

/** Straight-line distance between two points, in meters. */
export function haversineDistanceMeters(a: Coordinates, b: Coordinates): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

// ~14 km/h: a conservative city-cycling pace that accounts for lights and stops, not a
// bike courier's pace. Citibike's own average trip speeds land in this range.
const AVG_CYCLING_SPEED_MPS = 3.9;

// Streets aren't straight lines; scale the haversine distance up to approximate an actual
// street-network route without paying for a Directions API call per candidate pair.
const STRAIGHT_LINE_TO_STREET_FACTOR = 1.3;

/**
 * Fallback-only estimate of a bike leg's time/distance from straight-line distance, used when
 * a real Directions API call for that specific pair fails (see routing/candidateSearch.ts).
 * Not used for normal ranking — a flat straight-line fudge factor doesn't account for
 * one-way streets, bridges, or a grid forcing an L-shaped route, which real routing does.
 */
export function estimateBikeLeg(from: Coordinates, to: Coordinates): RouteLeg {
  const distanceMeters = haversineDistanceMeters(from, to) * STRAIGHT_LINE_TO_STREET_FACTOR;
  return {
    mode: "bike",
    durationSeconds: distanceMeters / AVG_CYCLING_SPEED_MPS,
    distanceMeters,
    geometry: null,
    estimated: true,
  };
}
