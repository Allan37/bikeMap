import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef } from "react";
import type { Coordinates, POI, RouteOption, Station } from "../types";
import { EMPTY_ROUTE_GEOJSON, ROUTE_CASING_LAYER_ID, ROUTE_LAYER_ID, ROUTE_SOURCE_ID, routeOptionToGeoJSON } from "./routeLayer";
import {
  INSIDE_LABEL_MINZOOM,
  STATION_CIRCLE_COLOR,
  STATION_CIRCLE_RADIUS,
  STATION_MIN_ZOOM,
  STATION_LABEL_EXTERNAL_FILTER,
  STATION_LABEL_EXTERNAL_LAYER_ID,
  STATION_LABEL_PARK_TEXT_FIELD,
  STATION_LABEL_TEXT_FIELD,
  STATION_LAYER_ID,
  type StationMode,
  STATION_SOURCE_ID,
  stationsToGeoJSON,
} from "./stationLayer";
import { stationPillHTML } from "./stationPill";

export type { StationMode };
import { useMapboxMap } from "./useMapboxMap";

// Lucide bike / zap glyphs as inline SVG for the (HTML-string) station popup — consistent with the
// Lucide icons used elsewhere, without pulling react-dom/server into the bundle for two icons.
const SVG_ATTRS = `class="pop-ic" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
const BIKE_ICON = `<svg ${SVG_ATTRS} stroke="#2e7d32"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>`;
const EBIKE_ICON = `<svg ${SVG_ATTRS} stroke="#f9a825"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;

interface MapViewProps {
  stations: Station[];
  destination: POI | null;
  /** A custom trip start, shown as a green marker. Null when starting from the live GPS dot. */
  origin: POI | null;
  /** Live GPS location; drives which stations get the earlier, lower-zoom count labels. */
  userLocation: Coordinates | null;
  selectedRoute: RouteOption | null;
  /** Whether station counts show bikes (manual/electric) or open parking docks. */
  mode: StationMode;
  onLocate: (position: Coordinates) => void;
  onLocateError?: (message: string) => void;
  onPoiSelect?: (poi: POI) => void;
  /** Hands App a function to programmatically trigger geolocation (for the "Use current location" button). */
  onLocateReady?: (locate: () => void) => void;
  /** Hands App a function to swoop the camera to a point (for the "pan to me" button). */
  onRecenterReady?: (recenter: (coords: Coordinates, zoom: number) => void) => void;
}

export function MapView({
  stations,
  destination,
  origin,
  userLocation,
  selectedRoute,
  mode,
  onLocate,
  onLocateError,
  onPoiSelect,
  onLocateReady,
  onRecenterReady,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { mapRef, isLoaded, locate, recenter } = useMapboxMap(containerRef, { onLocate, onLocateError, onPoiSelect });
  const destinationMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const originMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const pillsRef = useRef<Map<string, mapboxgl.Marker>>(new Map());

  useEffect(() => {
    onLocateReady?.(locate);
  }, [locate, onLocateReady]);

  useEffect(() => {
    onRecenterReady?.(recenter);
  }, [recenter, onRecenterReady]);

  // Add the station source/layer once the map has loaded.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoaded) return;
    if (map.getSource(STATION_SOURCE_ID)) return;

    map.addSource(STATION_SOURCE_ID, {
      type: "geojson",
      data: stationsToGeoJSON([]),
    });
    map.addLayer({
      id: STATION_LAYER_ID,
      type: "circle",
      source: STATION_SOURCE_ID,
      minzoom: STATION_MIN_ZOOM, // hide dots entirely on a city-wide view
      paint: {
        "circle-radius": STATION_CIRCLE_RADIUS,
        "circle-color": STATION_CIRCLE_COLOR,
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "#ffffff",
      },
    });
    // When zoomed out, float a number above only the nearest few stations. Zoomed in (14+), HTML
    // count pills take over (see the pills effect below). Wrapped defensively.
    try {
      map.addLayer({
        id: STATION_LABEL_EXTERNAL_LAYER_ID,
        type: "symbol",
        source: STATION_SOURCE_ID,
        minzoom: STATION_MIN_ZOOM,
        maxzoom: INSIDE_LABEL_MINZOOM,
        filter: STATION_LABEL_EXTERNAL_FILTER,
        layout: {
          "text-field": STATION_LABEL_TEXT_FIELD,
          "text-size": 12,
          "text-anchor": "bottom",
          "text-offset": [0, -0.6],
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: { "text-color": "#ffffff", "text-halo-color": "rgba(0, 0, 0, 0.7)", "text-halo-width": 1.6 },
      });
    } catch (err) {
      console.warn("[bikeMap] station count labels failed to initialize", err);
    }

    // Cursor feedback on hover (desktop only — touch devices have no hover, which is fine,
    // the tap-to-open-popup below works on both).
    map.on("mouseenter", STATION_LAYER_ID, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", STATION_LAYER_ID, () => {
      map.getCanvas().style.cursor = "";
    });

    // Tap/click opens a popup (works with mouse clicks and touch taps alike).
    // closeOnClick (default true) dismisses it when tapping elsewhere on the map.
    map.on("click", STATION_LAYER_ID, (e) => {
      const feature = e.features?.[0];
      if (!feature || feature.geometry.type !== "Point") return;
      const { name, bikesAvailable, ebikesAvailable, docksAvailable } = feature.properties as {
        name: string;
        bikesAvailable: number;
        ebikesAvailable: number;
        docksAvailable: number;
      };
      const standardBikes = bikesAvailable - ebikesAvailable;
      const bikesLabel =
        ebikesAvailable > 0
          ? `${bikesAvailable} bikes (${standardBikes}${BIKE_ICON} ${ebikesAvailable}${EBIKE_ICON})`
          : `${bikesAvailable} bikes`;
      // No close button — fiddly on mobile. closeOnMove dismisses it as soon as you pan/zoom even
      // slightly; closeOnClick (default) dismisses on a tap elsewhere.
      new mapboxgl.Popup({ closeButton: false, offset: 10, closeOnMove: true })
        .setLngLat(feature.geometry.coordinates as [number, number])
        .setHTML(`<strong>${name}</strong><br/>${bikesLabel} · ${docksAvailable} docks`)
        .addTo(map);
    });

    // Route line source/layers — walk legs dashed, bike leg solid, styled distinctly so the
    // three-part trip reads at a glance. A white casing beneath makes it pop off the map (Apple
    // Maps-style). Both inserted below the station dots so those stay tappable on top.
    map.addSource(ROUTE_SOURCE_ID, { type: "geojson", data: EMPTY_ROUTE_GEOJSON });
    map.addLayer(
      {
        id: ROUTE_CASING_LAYER_ID,
        type: "line",
        source: ROUTE_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 8, "line-opacity": 0.9 },
      },
      STATION_LAYER_ID,
    );
    map.addLayer(
      {
        id: ROUTE_LAYER_ID,
        type: "line",
        source: ROUTE_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["match", ["get", "mode"], "bike", "#2e7d32", "#007aff"],
          "line-width": 5,
          "line-dasharray": ["case", ["==", ["get", "mode"], "walk"], ["literal", [2, 2]], ["literal", [1, 0]]],
        },
      },
      STATION_LAYER_ID,
    );
  }, [isLoaded, mapRef]);

  // Push updated live data into the source whenever `stations` changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoaded) return;
    const source = map.getSource(STATION_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    // The trip's start is a chosen departure if set, else the live GPS location.
    const originCoords = origin ? { lat: origin.lat, lon: origin.lon } : userLocation;
    const destinationCoords = destination ? { lat: destination.lat, lon: destination.lon } : null;
    source?.setData(stationsToGeoJSON(stations, originCoords, destinationCoords));
  }, [stations, origin, userLocation, destination, isLoaded, mapRef]);

  // Swap the zoomed-out external labels between bikes and open docks on the bike/park toggle.
  // (Zoomed-in pills read `mode` directly in the pills effect below.)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoaded || !map.getLayer(STATION_LABEL_EXTERNAL_LAYER_ID)) return;
    try {
      const external = mode === "park" ? STATION_LABEL_PARK_TEXT_FIELD : STATION_LABEL_TEXT_FIELD;
      map.setLayoutProperty(STATION_LABEL_EXTERNAL_LAYER_ID, "text-field", external);
    } catch (err) {
      console.warn("[bikeMap] station label mode swap failed", err);
    }
  }, [mode, isLoaded, mapRef]);

  // HTML count pills once zoomed in (14+): one per visible station, reconciled on map idle. Only
  // stations in the source (already filtered to the nearest when routing) get a pill.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoaded) return;
    const pills = pillsRef.current;

    const updatePills = () => {
      try {
        if (map.getZoom() < INSIDE_LABEL_MINZOOM) {
          pills.forEach((m) => m.remove());
          pills.clear();
          return;
        }
        const seen = new Set<string>();
        for (const f of map.querySourceFeatures(STATION_SOURCE_ID)) {
          if (f.geometry.type !== "Point") continue;
          const p = f.properties ?? {};
          const id = String(p.stationId ?? "");
          if (!id || seen.has(id)) continue;
          seen.add(id);
          let marker = pills.get(id);
          if (!marker) {
            // Root stays untouched so mapbox keeps its own `mapboxgl-marker` class (which supplies
            // position:absolute) and positioning transform; our pill styling lives on an inner div.
            const root = document.createElement("div");
            root.appendChild(document.createElement("div"));
            marker = new mapboxgl.Marker({ element: root })
              .setLngLat(f.geometry.coordinates as [number, number])
              .addTo(map);
            pills.set(id, marker);
          }
          const inner = marker.getElement().firstElementChild as HTMLElement;
          inner.className = `station-pill station-pill--${String(p.availability)}`;
          inner.innerHTML = stationPillHTML(
            Number(p.bikesAvailable),
            Number(p.ebikesAvailable),
            Number(p.docksAvailable),
            String(p.availability),
            mode,
          );
        }
        for (const [id, m] of pills) {
          if (!seen.has(id)) {
            m.remove();
            pills.delete(id);
          }
        }
      } catch (err) {
        console.warn("[bikeMap] station pills failed", err);
      }
    };

    map.on("idle", updatePills);
    updatePills();
    return () => {
      map.off("idle", updatePills);
    };
  }, [isLoaded, mapRef, mode, stations]);

  // Drop/move a marker on the selected search destination and fly there.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoaded) return;

    if (!destination) {
      destinationMarkerRef.current?.remove();
      destinationMarkerRef.current = null;
      return;
    }

    const lngLat: [number, number] = [destination.lon, destination.lat];
    if (!destinationMarkerRef.current) {
      destinationMarkerRef.current = new mapboxgl.Marker({ color: "#007aff" }).setLngLat(lngLat).addTo(map);
    } else {
      destinationMarkerRef.current.setLngLat(lngLat);
    }
    map.flyTo({ center: lngLat, zoom: 15 });
  }, [destination, isLoaded, mapRef]);

  // Green marker for a custom trip start. Starting from the live GPS location instead shows the
  // built-in blue geolocate dot, so no marker is drawn in that case.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoaded) return;

    if (!origin) {
      originMarkerRef.current?.remove();
      originMarkerRef.current = null;
      return;
    }

    const lngLat: [number, number] = [origin.lon, origin.lat];
    if (!originMarkerRef.current) {
      originMarkerRef.current = new mapboxgl.Marker({ color: "#2e7d32" }).setLngLat(lngLat).addTo(map);
    } else {
      originMarkerRef.current.setLngLat(lngLat);
    }
  }, [origin, isLoaded, mapRef]);

  // Draw the selected route's legs and fit the map to show the whole trip.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoaded) return;
    const source = map.getSource(ROUTE_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;

    if (!selectedRoute) {
      source.setData(EMPTY_ROUTE_GEOJSON);
      return;
    }

    const geojson = routeOptionToGeoJSON(selectedRoute);
    source.setData(geojson);

    const bounds = new mapboxgl.LngLatBounds();
    geojson.features.forEach((feature) => {
      feature.geometry.coordinates.forEach((coord) => bounds.extend(coord as [number, number]));
    });
    if (!bounds.isEmpty()) {
      // Keep the user's current rotation instead of snapping back to north — Manhattan's grid reads
      // better tilted, and a sudden re-orient is jarring.
      map.fitBounds(bounds, { padding: 60, bearing: map.getBearing() });
    }
  }, [selectedRoute, isLoaded, mapRef]);

  return <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />;
}
