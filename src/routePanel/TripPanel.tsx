import { Bike, Footprints, TrainFront } from "lucide-react";
import { appleMapsTransitUrl } from "../routing/transitLink";
import type { TransitRoute } from "../routing/transitDirections";
import type { Coordinates, POI, RouteOption } from "../types";

export type TravelMode = "bike" | "subway";

interface TripPanelProps {
  destination: POI;
  /** Label for the trip origin — "Current location" or a chosen place's name. */
  originLabel: string;
  /** Whether we actually have origin coordinates yet (GPS fix or a chosen start). */
  hasOrigin: boolean;
  /** The trip's start coordinates, when known — needed for the subway handoff link. */
  originCoords: Coordinates | null;
  /** False = show the destination summary + "Directions" CTA; true = show the trip planner. */
  showDirections: boolean;
  /** How the user wants to get there: our own bike routing, or a handoff to transit directions. */
  travelMode: TravelMode;
  onTravelModeChange: (mode: TravelMode) => void;
  /** The single best route by time, or null while none is available. */
  route: RouteOption | null;
  isLoading: boolean;
  error: string | null;
  /** In-app subway route (Google Directions) for subway mode. */
  transitRoute: TransitRoute | null;
  isTransitLoading: boolean;
  transitError: string | null;
  onGetDirections: () => void;
  onEditOrigin: () => void;
  onUseCurrentLocation: () => void;
  onClear: () => void;
}

function formatMinutes(seconds: number): string {
  return `${Math.round(seconds / 60)} min`;
}

/** In-app subway route: total time, then colored line badges and walking legs. */
function TransitRouteView({ route }: { route: TransitRoute }) {
  return (
    <div className="transit-route">
      <div className="route-best-time">{formatMinutes(route.totalDurationSeconds)}</div>
      <div className="transit-steps">
        {route.steps
          // Skip trivial connector walks so the line sequence reads cleanly.
          .filter((s) => s.kind === "transit" || s.durationSeconds >= 60)
          .map((s, i) =>
            s.kind === "transit" ? (
              <div className="transit-step" key={`${s.line}-${i}`}>
                <span className="transit-line" style={{ background: s.lineColor ?? "#555" }}>
                  {s.line}
                </span>
                <span className="transit-step-text">
                  {s.numStops ? `${s.numStops} stop${s.numStops === 1 ? "" : "s"}` : "ride"}
                  {s.arrivalStop ? ` → ${s.arrivalStop}` : ""}
                </span>
              </div>
            ) : (
              <div className="transit-step" key={`walk-${i}`}>
                <Footprints size={16} className="transit-walk-icon" />
                <span className="transit-step-text">Walk {formatMinutes(s.durationSeconds)}</span>
              </div>
            ),
          )}
      </div>
    </div>
  );
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
  originCoords,
  showDirections,
  travelMode,
  onTravelModeChange,
  route,
  isLoading,
  error,
  transitRoute,
  isTransitLoading,
  transitError,
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

          <div className="travel-mode-toggle" role="group" aria-label="Travel mode" data-active={travelMode}>
            <button
              type="button"
              className={`travel-mode-option${travelMode === "bike" ? " travel-mode-option-active" : ""}`}
              onClick={() => onTravelModeChange("bike")}
            >
              <Bike size={16} />
              Bike
            </button>
            <button
              type="button"
              className={`travel-mode-option${travelMode === "subway" ? " travel-mode-option-active" : ""}`}
              onClick={() => onTravelModeChange("subway")}
            >
              <TrainFront size={16} />
              Subway
            </button>
          </div>

          {!hasOrigin ? (
            <div className="trip-origin-prompt">
              <button type="button" className="trip-directions-button" onClick={onUseCurrentLocation}>
                Use current location
              </button>
              <div className="trip-panel-status trip-panel-hint">or tap “From” to pick a starting point.</div>
            </div>
          ) : travelMode === "subway" ? (
            isTransitLoading ? (
              <div className="trip-panel-status">Finding a subway route…</div>
            ) : transitError ? (
              <div className="trip-panel-status">{transitError}</div>
            ) : !transitRoute ? (
              <div className="trip-panel-status">No subway route found near here.</div>
            ) : (
              <>
                <TransitRouteView route={transitRoute} />
                <a
                  className="trip-go-button"
                  href={appleMapsTransitUrl(originCoords!, { lat: destination.lat, lon: destination.lon })}
                  target="_blank"
                  rel="noreferrer"
                >
                  Go · open in Apple Maps →
                </a>
              </>
            )
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
