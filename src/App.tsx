import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStations } from "./citibike/useStations";
import { MapView } from "./map/MapView";
import { PoiCard } from "./poi/PoiCard";
import { matchBusiness, searchNearby } from "./poi/yelpClient";
import { TripPanel } from "./routePanel/TripPanel";
import { getBestRoutes } from "./routing/candidateSearch";
import { PlaceSearch } from "./search/PlaceSearch";
import { SearchBar } from "./search/SearchBar";
import type { Coordinates, POI, RouteOption, YelpBusiness } from "./types";

/** Compact freshness label for the status badge, e.g. "12s", "3m", "1h". */
function formatAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

function App() {
  const [userLocation, setUserLocation] = useState<Coordinates | null>(null);
  const [destination, setDestination] = useState<POI | null>(null);
  // A custom trip start. Null means "start from the live GPS location" (userLocation).
  const [origin, setOrigin] = useState<POI | null>(null);
  const [showDirections, setShowDirections] = useState(false);
  const [isEditingOrigin, setIsEditingOrigin] = useState(false);

  // The trip's effective start: a chosen origin if set, otherwise the live GPS location.
  const originCoords = useMemo<Coordinates | null>(
    () => (origin ? { lat: origin.lat, lon: origin.lon } : userLocation),
    [origin, userLocation],
  );
  const originLabel = origin ? origin.name : "Current location";

  // Both endpoints set means the user is actively looking at a trip, about to depart — worth
  // polling station data harder for. See config.ts for why this doesn't just mean "poll fastest."
  const isActivelyRouting = originCoords !== null && destination !== null;
  const { stations, lastUpdated, error } = useStations(isActivelyRouting);
  const stationsRef = useRef(stations);
  stationsRef.current = stations;

  // Programmatic geolocation trigger, handed up from the map's GeolocateControl.
  const locateRef = useRef<() => void>(() => {});
  const handleLocateReady = useCallback((fn: () => void) => {
    locateRef.current = fn;
  }, []);

  // We only ever surface the single best route by time — a walk-bike-walk trip doesn't warrant a
  // pick list — so this holds just that one (getBestRoutes still ranks internally).
  const [bestRoute, setBestRoute] = useState<RouteOption | null>(null);
  const [isRouteLoading, setIsRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  const [poiBusiness, setPoiBusiness] = useState<YelpBusiness | null>(null);
  const [isPoiCardDismissed, setIsPoiCardDismissed] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  // Selecting a destination (via search or a map POI tap) shows its summary first; the user
  // taps "Directions" from there to start planning a trip.
  const selectDestination = useCallback((poi: POI) => {
    setDestination(poi);
    setShowDirections(false);
    setIsEditingOrigin(false);
  }, []);

  const clearDestination = useCallback(() => {
    setDestination(null);
    setShowDirections(false);
    setBestRoute(null);
  }, []);

  const useCurrentLocationAsStart = useCallback(() => {
    setOrigin(null); // fall back to the live GPS location…
    setIsEditingOrigin(false);
    locateRef.current(); // …and (re)trigger a fix.
  }, []);

  // Dev convenience: set location/destination manually, without needing real GPS or the
  // search UI. e.g. window.__setUserLocation({ lat: 40.75, lon: -73.99 })
  if (import.meta.env.DEV) {
    (window as any).__setUserLocation = setUserLocation;
    (window as any).__setDestination = setDestination;
  }

  // Recompute candidate routes whenever the trip's start or destination changes — deliberately
  // NOT on every station-data poll tick (reads stationsRef instead), since re-ranking on every
  // poll would be both wasteful and visually jumpy.
  useEffect(() => {
    if (!originCoords || !destination) {
      setBestRoute(null);
      return;
    }
    let cancelled = false;
    setIsRouteLoading(true);
    setRouteError(null);
    getBestRoutes(originCoords, { lat: destination.lat, lon: destination.lon }, stationsRef.current)
      .then((options) => {
        if (cancelled) return;
        setBestRoute(options[0] ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        setRouteError(err instanceof Error ? err.message : "Failed to find routes");
      })
      .finally(() => {
        if (!cancelled) setIsRouteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [originCoords, destination]);

  // Look up a Yelp match for the selected destination (name + location), for the POI card.
  useEffect(() => {
    setPoiBusiness(null);
    setIsPoiCardDismissed(false);
    if (!destination) return;
    let cancelled = false;
    searchNearby(destination.lat, destination.lon, destination.name)
      .then((results) => {
        if (cancelled) return;
        setPoiBusiness(matchBusiness(results, destination.name));
      })
      .catch((err) => {
        console.error("Yelp search failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [destination]);

  // Ticks once a second so the "data Xs old" badge counts up between station-data polls.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <MapView
        stations={stations}
        destination={destination}
        origin={origin}
        userLocation={userLocation}
        selectedRoute={bestRoute}
        onLocate={(position) => {
          setUserLocation(position);
          setLocateError(null);
        }}
        onLocateError={setLocateError}
        onPoiSelect={selectDestination}
        onLocateReady={handleLocateReady}
      />
      {/* The top search bar steps aside in directions mode so it never collides with the
          start-location editor or clutters the trip view. */}
      {!showDirections && <SearchBar onSelect={selectDestination} />}
      {poiBusiness && !isPoiCardDismissed && !showDirections && (
        <PoiCard business={poiBusiness} onClose={() => setIsPoiCardDismissed(true)} />
      )}
      {destination && (
        <TripPanel
          destination={destination}
          originLabel={originLabel}
          hasOrigin={originCoords !== null}
          showDirections={showDirections}
          route={bestRoute}
          isLoading={isRouteLoading}
          error={routeError}
          onGetDirections={() => setShowDirections(true)}
          onEditOrigin={() => setIsEditingOrigin(true)}
          onUseCurrentLocation={useCurrentLocationAsStart}
          onClear={clearDestination}
        />
      )}
      {isEditingOrigin && (
        <div className="origin-editor">
          <div className="search-bar origin-editor-search">
            <PlaceSearch
              placeholder="Choose start location"
              autoFocus
              leadingOption={{ label: "📍 Current location", onSelect: useCurrentLocationAsStart }}
              onSelect={(poi) => {
                setOrigin(poi);
                setIsEditingOrigin(false);
              }}
            />
          </div>
          <button type="button" className="origin-editor-cancel" onClick={() => setIsEditingOrigin(false)}>
            Cancel
          </button>
        </div>
      )}
      {locateError && <div className="locate-error">{locateError}</div>}
      <div className="status-badge">
        {error
          ? `Station data error: ${error}`
          : lastUpdated
            ? `data ${formatAge(now - lastUpdated.getTime())} old`
            : "Loading…"}
      </div>
    </div>
  );
}

export default App;
