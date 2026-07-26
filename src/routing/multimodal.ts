import type { Coordinates, RouteOption, Station } from "../types";
import { getBestRoutes } from "./candidateSearch";
import { estimateBikeLeg, haversineDistanceMeters } from "./scoring";
import { subwayLinesNear, subwayStationsNear } from "./subwayStations";
import { fetchTransitRoute, type TransitRoute } from "./transitDirections";

/**
 * Bike + Subway planner, generalized: a trip is bike(origin→A) + train(A→B) + bike(B→dest), where
 * either bike leg may be absent. Bikes act as walk-radius EXPANDERS (reach a better line in the
 * time you'd walk to a worse one) and TRANSFER KILLERS (a transfer that advances 1–2 stops loses
 * to biking from the pre-transfer station).
 *
 * We can't search the transit graph ourselves, so Google is the oracle and the search is over cut
 * points, kept cheap in three ways:
 *  1. One baseline call (origin→dest) gives Google's best pure-transit time T₀ — the bar to beat —
 *     plus its own entry stop A₀ and per-step structure.
 *  2. Entry candidates come from the bundled MTA stations dataset, scored with haversine-based
 *     estimates (zero API calls); only the best 1–2 get a verification call transit(A→dest).
 *  3. Exit cuts need NO extra calls: any verified route can be truncated after a transit step and
 *     the remainder biked. Tail-cutting entry-verified routes yields both-ends-bike plans free,
 *     which is why (A,B) pairs are never verified separately.
 *
 * Total budget: 1 baseline + ≤3 verification Google calls, Mapbox calls only for the winner's legs.
 */

// Bike legs only make sense in this straight-line band: closer is walkable, farther isn't worth it.
const BIKE_MIN_METERS = 400;
const BIKE_MAX_METERS = 3200;
// "Lines that serve the destination" = lines at stations within a walk of it.
const DEST_WALK_RADIUS_METERS = 1000;
// Junction buffers (station entry/exit sinks folded in, per your ~1 min/end model).
const BIKE_TO_TRAIN_BUFFER_S = 180; // dock, enter, reach the platform
const TRAIN_TO_BIKE_BUFFER_S = 120; // exit, undock
// Estimate-only constants.
const BIKE_FIXED_OVERHEAD_S = 240; // walk to a dock + undock + dock + walk out
const WALK_MPS = 1.4;
const WALK_STREET_FACTOR = 1.35;
const SUBWAY_MPS = 8.3; // ~30 km/h including stops
const TRAIN_WAIT_EST_S = 300;
// A plan must beat pure transit by this much on estimates to be pursued, and by FINAL after
// real bike routing — nobody wants a combo that saves 40 seconds.
const WORTH_IT_MARGIN_S = 180;
const FINAL_MARGIN_S = 60;
const MAX_ENTRY_VERIFICATIONS = 2;
// A final train ride this short (in stops) is presumed a killable transfer.
const SHORT_FINAL_RIDE_STOPS = 3;

interface NamedPoint {
  coords: Coordinates;
  name: string;
}

export interface MultimodalRoute {
  /** Citibike leg origin → entry station; null when transit starts from the origin as usual. */
  startBike: RouteOption | null;
  /** Citibike leg exit station → destination; null when transit runs to the destination as usual. */
  endBike: RouteOption | null;
  transit: TransitRoute;
  entryStopName: string | null;
  exitStopName: string | null;
  totalDurationSeconds: number;
}

/** One candidate way to run the trip, with an estimated total for ranking. */
interface Plan {
  entry: NamedPoint | null;
  exit: NamedPoint | null;
  transit: TransitRoute;
  estSeconds: number;
}

function bikeTripEstSeconds(from: Coordinates, to: Coordinates): number {
  return estimateBikeLeg(from, to).durationSeconds + BIKE_FIXED_OVERHEAD_S;
}

function walkEstSeconds(from: Coordinates, to: Coordinates): number {
  return (haversineDistanceMeters(from, to) * WALK_STREET_FACTOR) / WALK_MPS;
}

function transitStepIndices(route: TransitRoute): number[] {
  return route.steps.flatMap((s, i) => (s.kind === "transit" ? [i] : []));
}

function initialWalkSeconds(route: TransitRoute): number {
  const first = transitStepIndices(route)[0];
  if (first === undefined) return 0;
  return route.steps.slice(0, first).reduce((sum, s) => sum + s.durationSeconds, 0);
}

/** Trip time through step `index` inclusive. Any unattributed time (initial wait — Google's leg
    total exceeds the step sum) is charged to the prefix, since waiting happens up front. */
function prefixSeconds(route: TransitRoute, index: number): number {
  const stepSum = route.steps.reduce((sum, s) => sum + s.durationSeconds, 0);
  const gap = Math.max(0, route.totalDurationSeconds - stepSum);
  return route.steps.slice(0, index + 1).reduce((sum, s) => sum + s.durationSeconds, 0) + gap;
}

function truncateAfter(route: TransitRoute, index: number): TransitRoute {
  return {
    totalDurationSeconds: prefixSeconds(route, index),
    departureText: route.departureText,
    arrivalText: route.arrivalText,
    steps: route.steps.slice(0, index + 1),
  };
}

/** Exit-cut candidates for a transit route: hop off after a late transit step and bike the rest. */
function tailCuts(route: TransitRoute, dest: Coordinates): Array<{ index: number; exit: NamedPoint }> {
  const tIdx = transitStepIndices(route);
  if (tIdx.length === 0) return [];
  const candidates: number[] = [tIdx[tIdx.length - 1]];
  // Killing the final ride too (it's a transfer's payoff) only makes sense when that ride is short.
  if (tIdx.length >= 2) {
    const lastRide = route.steps[tIdx[tIdx.length - 1]];
    if ((lastRide.numStops ?? 99) <= SHORT_FINAL_RIDE_STOPS) candidates.push(tIdx[tIdx.length - 2]);
  }
  const cuts: Array<{ index: number; exit: NamedPoint }> = [];
  for (const index of candidates) {
    const step = route.steps[index];
    const coords = step.arrivalCoords;
    if (!coords) continue;
    const d = haversineDistanceMeters(coords, dest);
    if (d < BIKE_MIN_METERS || d > BIKE_MAX_METERS) continue;
    cuts.push({ index, exit: { coords, name: step.arrivalStop || "the subway" } });
  }
  return cuts;
}

/** All plans derivable from one transit route: as-is, plus each viable exit cut. */
function plansFrom(entry: NamedPoint | null, route: TransitRoute, origin: Coordinates, dest: Coordinates): Plan[] {
  const entryCost = entry ? bikeTripEstSeconds(origin, entry.coords) + BIKE_TO_TRAIN_BUFFER_S : 0;
  const plans: Plan[] = [{ entry, exit: null, transit: route, estSeconds: entryCost + route.totalDurationSeconds }];
  for (const cut of tailCuts(route, dest)) {
    plans.push({
      entry,
      exit: cut.exit,
      transit: truncateAfter(route, cut.index),
      estSeconds:
        entryCost + prefixSeconds(route, cut.index) + TRAIN_TO_BIKE_BUFFER_S + bikeTripEstSeconds(cut.exit.coords, dest),
    });
  }
  return plans;
}

/** Entry candidates from the stations dataset — the walk-radius-expander move. */
function datasetEntryCandidates(
  origin: Coordinates,
  dest: Coordinates,
  baselineEntry: NamedPoint | null,
): Array<{ point: NamedPoint; estSeconds: number }> {
  const destLines = subwayLinesNear(dest, DEST_WALK_RADIUS_METERS);
  if (destLines.size === 0) return [];
  const destStations = subwayStationsNear(dest, 0, DEST_WALK_RADIUS_METERS);

  const scored: Array<{ point: NamedPoint; estSeconds: number }> = [];
  for (const s of subwayStationsNear(origin, BIKE_MIN_METERS, BIKE_MAX_METERS)) {
    const shared = s.lines.filter((l) => destLines.has(l));
    if (shared.length === 0) continue;
    const coords = { lat: s.lat, lon: s.lon };
    // Skip Google's own pick — it's handled as its own candidate.
    if (baselineEntry && haversineDistanceMeters(coords, baselineEntry.coords) < 250) continue;
    // Estimated door-to-door via the best shared-line landing station near the destination.
    let best = Number.POSITIVE_INFINITY;
    for (const d of destStations) {
      if (!d.lines.some((l) => shared.includes(l))) continue;
      const dCoords = { lat: d.lat, lon: d.lon };
      const t =
        haversineDistanceMeters(coords, dCoords) / SUBWAY_MPS + TRAIN_WAIT_EST_S + walkEstSeconds(dCoords, dest);
      if (t < best) best = t;
    }
    if (!Number.isFinite(best)) continue;
    scored.push({
      point: { coords, name: s.name },
      estSeconds: bikeTripEstSeconds(origin, coords) + BIKE_TO_TRAIN_BUFFER_S + best,
    });
  }

  // Sort, then greedily de-dupe station complexes (Court Sq appears once per line group).
  scored.sort((a, b) => a.estSeconds - b.estSeconds);
  const kept: Array<{ point: NamedPoint; estSeconds: number }> = [];
  for (const c of scored) {
    if (kept.some((k) => haversineDistanceMeters(k.point.coords, c.point.coords) < 200)) continue;
    kept.push(c);
    if (kept.length >= MAX_ENTRY_VERIFICATIONS) break;
  }
  return kept;
}

export async function getMultimodalRoute(
  origin: Coordinates,
  destination: Coordinates,
  stations: Station[],
): Promise<MultimodalRoute | null> {
  const baseline = await fetchTransitRoute(origin, destination);
  if (!baseline) return null;
  const t0 = baseline.totalDurationSeconds;

  // Google's own entry stop, as a bike-to candidate when its approach walk is nontrivial.
  const firstTransit = route0FirstTransit(baseline);
  let baselineEntry: NamedPoint | null = null;
  if (firstTransit?.departureCoords) {
    const d = haversineDistanceMeters(origin, firstTransit.departureCoords);
    if (initialWalkSeconds(baseline) >= 300 && d >= BIKE_MIN_METERS && d <= BIKE_MAX_METERS) {
      baselineEntry = { coords: firstTransit.departureCoords, name: firstTransit.departureStop || "the subway" };
    }
  }

  // Verification calls (≤3, in parallel): Google's entry + the best dataset entries.
  const entryCandidates: NamedPoint[] = [
    ...(baselineEntry ? [baselineEntry] : []),
    ...datasetEntryCandidates(origin, destination, baselineEntry).map((c) => c.point),
  ];
  const verified = await Promise.all(
    entryCandidates.map(async (entry) => {
      try {
        return { entry, route: await fetchTransitRoute(entry.coords, destination) };
      } catch {
        return { entry, route: null };
      }
    }),
  );

  // Assemble every plan: baseline as-is + its tail cuts, and each verified entry route + its cuts.
  const plans: Plan[] = plansFrom(null, baseline, origin, destination);
  for (const { entry, route } of verified) {
    if (route) plans.push(...plansFrom(entry, route, origin, destination));
  }
  plans.sort((a, b) => a.estSeconds - b.estSeconds);

  // Materialize the best plan that (a) beats pure transit by the margin and (b) has real bike
  // routes available (live availability can kill a leg). Two attempts bounds Mapbox spend.
  let attempts = 0;
  for (const plan of plans) {
    if (!plan.entry && !plan.exit) continue; // that's just the pure-transit baseline
    if (plan.estSeconds >= t0 - WORTH_IT_MARGIN_S) break; // sorted — nothing further can qualify
    if (attempts >= 2) break;
    attempts += 1;

    const [startBike, endBike] = await Promise.all([
      plan.entry ? getBestRoutes(origin, plan.entry.coords, stations).then((r) => r[0] ?? null) : Promise.resolve(null),
      plan.exit ? getBestRoutes(plan.exit.coords, destination, stations).then((r) => r[0] ?? null) : Promise.resolve(null),
    ]);
    if (plan.entry && !startBike) continue;
    if (plan.exit && !endBike) continue;

    const total =
      (startBike ? startBike.totalDurationSeconds + BIKE_TO_TRAIN_BUFFER_S : 0) +
      plan.transit.totalDurationSeconds +
      (endBike ? TRAIN_TO_BIKE_BUFFER_S + endBike.totalDurationSeconds : 0);
    if (total >= t0 - FINAL_MARGIN_S) continue;

    return {
      startBike,
      endBike,
      transit: plan.transit,
      entryStopName: plan.entry?.name ?? null,
      exitStopName: plan.exit?.name ?? null,
      totalDurationSeconds: total,
    };
  }
  return null;
}

function route0FirstTransit(route: TransitRoute) {
  return route.steps.find((s) => s.kind === "transit") ?? null;
}
