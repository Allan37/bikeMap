import type { RouteOption } from "../types";

interface RoutePanelProps {
  options: RouteOption[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  isLoading: boolean;
  error: string | null;
  /** Distinguishes "haven't searched yet" (render nothing) from "searched, found nothing viable". */
  hasSearched: boolean;
}

function formatMinutes(seconds: number): string {
  return `${Math.round(seconds / 60)} min`;
}

export function RoutePanel({ options, selectedIndex, onSelect, isLoading, error, hasSearched }: RoutePanelProps) {
  if (!hasSearched) return null;

  if (isLoading) {
    return (
      <div className="route-panel">
        <div className="route-panel-status">Finding routes…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="route-panel">
        <div className="route-panel-status">{error}</div>
      </div>
    );
  }

  if (options.length === 0) {
    return (
      <div className="route-panel">
        <div className="route-panel-status">No nearby station has both a bike and a place to dock near your destination.</div>
      </div>
    );
  }

  return (
    <div className="route-panel">
      {options.map((option, index) => (
        <button
          key={`${option.originStation.stationId}-${option.destinationStation.stationId}`}
          type="button"
          className={`route-option${index === selectedIndex ? " route-option-selected" : ""}`}
          onClick={() => onSelect(index)}
        >
          <div className="route-option-time">
            {option.bikeLeg.estimated ? "~" : ""}
            {formatMinutes(option.totalDurationSeconds)}
          </div>
          <div className="route-option-detail">
            Walk {formatMinutes(option.walkToStation.durationSeconds)} to {option.originStation.name} · Bike{" "}
            {option.bikeLeg.estimated ? "~" : ""}
            {formatMinutes(option.bikeLeg.durationSeconds)} to {option.destinationStation.name} · Walk{" "}
            {formatMinutes(option.walkFromStation.durationSeconds)}
          </div>
        </button>
      ))}
    </div>
  );
}
