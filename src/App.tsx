import { useStations } from "./citibike/useStations";
import { MapView } from "./map/MapView";

function App() {
  const { stations, lastUpdated, error } = useStations();

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <MapView stations={stations} />
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
