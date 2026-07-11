import { useEffect, useRef, useState } from "react";
import { useStations } from "./citibike/useStations";
import { MapView } from "./map/MapView";
import { getBestRoutes } from "./routing/candidateSearch";
import { RoutePanel } from "./routePanel/RoutePanel";
import { SearchBar } from "./search/SearchBar";
import type { Coordinates, POI, RouteOption } from "./types";

function App() {
  const [userLocation, setUserLocation] = useState<Coordinates | null>(null);
  const [destination, setDestination] = useState<POI | null>(null);

  // Both set means the user is actively looking at a trip, about to depart — worth polling
  // station data harder for. See config.ts for why this doesn't just mean "poll as fast as
  // possible."
  const isActivelyRouting = userLocation !== null && destination !== null;
  const { stations, lastUpdated, error } = useStations(isActivelyRouting);
  const stationsRef = useRef(stations);
  stationsRef.current = stations;

  // Dev convenience: set location/destination manually, without needing real GPS or the
  // search UI. e.g. window.__setUserLocation({ lat: 40.75, lon: -73.99 })
  if (import.meta.env.DEV) {
    (window as any).__setUserLocation = setUserLocation;
    (window as any).__setDestination = setDestination;
  }

  const [routeOptions, setRouteOptions] = useState<RouteOption[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isRouteLoading, setIsRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  // Recompute candidate routes whenever the user picks a new destination or their location
  // updates — deliberately NOT on every 30s station-data poll tick (reads stationsRef
  // instead), since re-ranking on every poll would be both wasteful and visually jumpy.
  useEffect(() => {
    if (!userLocation || !destination) {
      setRouteOptions([]);
      return;
    }
    let cancelled = false;
    setIsRouteLoading(true);
    setRouteError(null);
    getBestRoutes(userLocation, { lat: destination.lat, lon: destination.lon }, stationsRef.current)
      .then((options) => {
        if (cancelled) return;
        setRouteOptions(options);
        setSelectedIndex(0);
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
  }, [userLocation, destination]);

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <MapView
        stations={stations}
        destination={destination}
        selectedRoute={routeOptions[selectedIndex] ?? null}
        onLocate={setUserLocation}
      />
      <SearchBar onSelect={setDestination} />
      <RoutePanel
        options={routeOptions}
        selectedIndex={selectedIndex}
        onSelect={setSelectedIndex}
        isLoading={isRouteLoading}
        error={routeError ?? (destination && !userLocation ? "Tap the location button to find routes from where you are." : null)}
        hasSearched={destination !== null}
      />
      <div className="status-badge">
        {error
          ? `Station data error: ${error}`
          : lastUpdated
            ? `${stations.length} stations · updated ${lastUpdated.toLocaleTimeString()}`
            : "Loading stations…"}
      </div>
    </div>
  );
}

export default App;
