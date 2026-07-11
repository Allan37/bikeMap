import { useState } from "react";
import { useStations } from "./citibike/useStations";
import { MapView } from "./map/MapView";
import { SearchBar } from "./search/SearchBar";
import type { POI } from "./types";

function App() {
  const { stations, lastUpdated, error } = useStations();
  const [destination, setDestination] = useState<POI | null>(null);

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <MapView stations={stations} destination={destination} />
      <SearchBar onSelect={setDestination} />
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
