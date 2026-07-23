import type { Coordinates } from "../types";

/**
 * Deep link that opens Apple Maps public-transit directions for the full trip. We don't run our
 * own GTFS trip planner (no bike-train optimization yet — see plan.md phase 2), so "subway" mode
 * is a straight handoff: Apple Maps already knows the MTA schedule/transfers better than we could.
 */
export function appleMapsTransitUrl(origin: Coordinates, destination: Coordinates): string {
  return `https://maps.apple.com/?saddr=${origin.lat},${origin.lon}&daddr=${destination.lat},${destination.lon}&dirflg=r`;
}
