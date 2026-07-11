import type { POI, RouteOption } from "../types";

interface TripPanelProps {
  destination: POI;
  /** Label for the trip origin — "Current location" or a chosen place's name. */
  originLabel: string;
  /** Whether we actually have origin coordinates yet (GPS fix or a chosen start). */
  hasOrigin: boolean;
  /** False = show the destination summary + "Directions" CTA; true = show the trip planner. */
  showDirections: boolean;
  /** The single best route by time, or null while none is available. */
  route: RouteOption | null;
  isLoading: boolean;
  error: string | null;
  onGetDirections: () => void;
  onEditOrigin: () => void;
  onUseCurrentLocation: () => void;
  onClear: () => void;
}

function formatMinutes(seconds: number): string {
  return `${Math.round(seconds / 60)} min`;
}

/** Deep link that opens Apple Maps directions for the bike leg — origin station to destination station. */
function appleMapsBikeLegUrl(route: RouteOption): string {
  const { originStation: o, destinationStation: d } = route;
  // Apple Maps' URL scheme only supports drive/walk/transit for dirflg (no cycling flag exists),
  // so we omit it — Maps opens the route in its current mode and the rider taps the bike icon.
  return `https://maps.apple.com/?saddr=${o.lat},${o.lon}&daddr=${d.lat},${d.lon}`;
}

export function TripPanel({
  destination,
  originLabel,
  hasOrigin,
  showDirections,
  route,
  isLoading,
  error,
  onGetDirections,
  onEditOrigin,
  onUseCurrentLocation,
  onClear,
}: TripPanelProps) {
  return (
    <div className="trip-panel">
      <div className="trip-panel-header">
        <div className="trip-panel-title">{destination.name}</div>
        <button type="button" className="trip-panel-close" onClick={onClear} aria-label="Clear destination">
          ×
        </button>
      </div>
      {destination.placeFormatted && <div className="trip-panel-subtitle">{destination.placeFormatted}</div>}

      {!showDirections ? (
        <button type="button" className="trip-directions-button" onClick={onGetDirections}>
          Directions
        </button>
      ) : (
        <>
          <div className="trip-endpoints">
            <button type="button" className="trip-endpoint trip-endpoint-editable" onClick={onEditOrigin}>
              <span className="trip-endpoint-label">From</span>
              <span className="trip-endpoint-value">{originLabel}</span>
              <span className="trip-endpoint-edit">Change</span>
            </button>
            <div className="trip-endpoint">
              <span className="trip-endpoint-label">To</span>
              <span className="trip-endpoint-value">{destination.name}</span>
            </div>
          </div>

          {!hasOrigin ? (
            <div className="trip-origin-prompt">
              <button type="button" className="trip-directions-button" onClick={onUseCurrentLocation}>
                Use current location
              </button>
              <div className="trip-panel-status trip-panel-hint">or tap “From” to pick a starting point.</div>
            </div>
          ) : isLoading ? (
            <div className="trip-panel-status">Finding the best route…</div>
          ) : error ? (
            <div className="trip-panel-status">{error}</div>
          ) : !route ? (
            <div className="trip-panel-status">
              No nearby station has both a bike and a place to dock near your destination.
            </div>
          ) : (
            <>
              <div className="route-best">
                <div className="route-best-time">
                  {route.bikeLeg.estimated ? "~" : ""}
                  {formatMinutes(route.totalDurationSeconds)}
                </div>
                <div className="route-best-detail">
                  Walk {formatMinutes(route.walkToStation.durationSeconds)} to {route.originStation.name} · Bike{" "}
                  {route.bikeLeg.estimated ? "~" : ""}
                  {formatMinutes(route.bikeLeg.durationSeconds)} to {route.destinationStation.name} · Walk{" "}
                  {formatMinutes(route.walkFromStation.durationSeconds)}
                </div>
              </div>
              <a className="trip-go-button" href={appleMapsBikeLegUrl(route)} target="_blank" rel="noreferrer">
                Go · bike leg in Apple Maps →
              </a>
            </>
          )}
        </>
      )}
    </div>
  );
}
