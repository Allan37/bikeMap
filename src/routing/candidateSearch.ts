import { CANDIDATE_STATION_COUNT, MAX_ROUTE_OPTIONS } from "../config";
import type { Coordinates, RouteOption, Station } from "../types";
import { getCyclingRoute, getWalkingRoute } from "./mapboxDirections";
import { estimateBikeLeg, haversineDistanceMeters } from "./scoring";

function stationCoords(station: Station): Coordinates {
  return { lat: station.lat, lon: station.lon };
}

/** Nearest `count` stations to `point` matching `predicate` (e.g. "has a bike"), by straight-line distance. */
function findNearbyStations(point: Coordinates, stations: Station[], predicate: (s: Station) => boolean, count: number): Station[] {
  return stations
    .filter(predicate)
    .map((station) => ({ station, distance: haversineDistanceMeters(point, stationCoords(station)) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count)
    .map((entry) => entry.station);
}

/**
 * Ranks candidate walk-to-station -> bike -> walk-from-station routes from `start` to `end`.
 *
 * Fetches real Directions for every leg, including the bike leg for every candidate pair
 * (N + M walk calls + N*M bike calls). At CANDIDATE_STATION_COUNT=3 that's 15 calls per
 * search — trivial against Mapbox's 100k/month free Directions tier, and it actually models
 * the street network (one-way streets, bridges, avenue loops) instead of guessing from
 * straight-line distance, which matters in a grid city. If a specific bike-leg request fails
 * (rate limit, network blip), that one pair falls back to a straight-line estimate rather
 * than dropping the whole search — check `bikeLeg.estimated` before trusting a leg's time.
 *
 * Returns [] if no station near the start has a bike, or none near the end has a dock.
 */
export async function getBestRoutes(start: Coordinates, end: Coordinates, stations: Station[]): Promise<RouteOption[]> {
  const originCandidates = findNearbyStations(start, stations, (s) => (s.status?.bikesAvailable ?? 0) > 0, CANDIDATE_STATION_COUNT);
  const destCandidates = findNearbyStations(end, stations, (s) => (s.status?.docksAvailable ?? 0) > 0, CANDIDATE_STATION_COUNT);

  if (originCandidates.length === 0 || destCandidates.length === 0) {
    return [];
  }

  const pairs = originCandidates.flatMap((originStation) => destCandidates.map((destStation) => ({ originStation, destStation })));

  const [walksToOrigin, walksFromDest, bikeLegs] = await Promise.all([
    Promise.all(originCandidates.map((s) => getWalkingRoute(start, stationCoords(s)))),
    Promise.all(destCandidates.map((s) => getWalkingRoute(stationCoords(s), end))),
    Promise.all(
      pairs.map(({ originStation, destStation }) =>
        getCyclingRoute(stationCoords(originStation), stationCoords(destStation)).catch(() =>
          estimateBikeLeg(stationCoords(originStation), stationCoords(destStation)),
        ),
      ),
    ),
  ]);

  const options: RouteOption[] = pairs.map(({ originStation, destStation }, pairIndex) => {
    const walkToStation = walksToOrigin[originCandidates.indexOf(originStation)];
    const walkFromStation = walksFromDest[destCandidates.indexOf(destStation)];
    const bikeLeg = bikeLegs[pairIndex];
    return {
      originStation,
      destinationStation: destStation,
      walkToStation,
      bikeLeg,
      walkFromStation,
      totalDurationSeconds: walkToStation.durationSeconds + bikeLeg.durationSeconds + walkFromStation.durationSeconds,
    };
  });

  options.sort((a, b) => a.totalDurationSeconds - b.totalDurationSeconds);
  return options.slice(0, MAX_ROUTE_OPTIONS);
}
