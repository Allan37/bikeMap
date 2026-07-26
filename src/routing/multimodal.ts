import type { Coordinates, RouteOption, Station } from "../types";
import { getBestRoutes } from "./candidateSearch";
import { fetchTransitRoute, type TransitRoute } from "./transitDirections";

/**
 * Bike + Subway planner: replace the transit route's initial walk with a Citibike leg.
 *
 * Google's transit routing already picks the best entry subway stop for a trip; we ask it for the
 * full route once, and if the walk to that first stop is long enough to be worth biking, we route a
 * walk→bike→walk leg (existing Citibike planner) from the origin to the stop, then re-fetch transit
 * FROM the stop so times reflect actually boarding there. Two Google calls + the usual Mapbox calls.
 */

// Below this initial walk, plain subway wins — biking adds dock/undock overhead for no real gain.
const MIN_FIRST_WALK_SECONDS = 6 * 60;
// Padding for docking the bike and getting down to the platform.
const DOCK_AND_BOARD_BUFFER_SECONDS = 3 * 60;

export interface MultimodalRoute {
  /** Citibike leg: origin → the subway entry stop. */
  bike: RouteOption;
  /** Transit route boarding at that stop. */
  transit: TransitRoute;
  entryStopName: string;
  totalDurationSeconds: number;
}

export async function getMultimodalRoute(
  origin: Coordinates,
  destination: Coordinates,
  stations: Station[],
): Promise<MultimodalRoute | null> {
  const full = await fetchTransitRoute(origin, destination);
  if (!full) return null;

  const firstTransitIndex = full.steps.findIndex((s) => s.kind === "transit");
  if (firstTransitIndex === -1) return null;
  const firstTransit = full.steps[firstTransitIndex];
  const stop = firstTransit.departureCoords;
  if (!stop) return null;

  // How long transit alone would have you walking before boarding.
  const initialWalkSeconds = full.steps
    .slice(0, firstTransitIndex)
    .reduce((sum, s) => sum + s.durationSeconds, 0);
  if (initialWalkSeconds < MIN_FIRST_WALK_SECONDS) return null;

  const [bikeOptions, transitFromStop] = await Promise.all([
    getBestRoutes(origin, stop, stations),
    fetchTransitRoute(stop, destination),
  ]);
  const bike = bikeOptions[0];
  if (!bike || !transitFromStop) return null;

  return {
    bike,
    transit: transitFromStop,
    entryStopName: firstTransit.departureStop || "the subway",
    totalDurationSeconds:
      bike.totalDurationSeconds + DOCK_AND_BOARD_BUFFER_SECONDS + transitFromStop.totalDurationSeconds,
  };
}
