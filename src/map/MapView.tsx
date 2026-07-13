import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef } from "react";
import type { Coordinates, POI, RouteOption, Station } from "../types";
import { EMPTY_ROUTE_GEOJSON, ROUTE_LAYER_ID, ROUTE_SOURCE_ID, routeOptionToGeoJSON } from "./routeLayer";
import {
  DETAIL_LABEL_MINZOOM,
  INSIDE_LABEL_MINZOOM,
  STATION_CIRCLE_COLOR,
  STATION_CIRCLE_RADIUS,
  STATION_LABEL_DETAIL_FILTER,
  STATION_LABEL_DETAIL_LAYER_ID,
  STATION_LABEL_DETAIL_TEXT_FIELD,
  STATION_LABEL_EXTERNAL_FILTER,
  STATION_LABEL_EXTERNAL_LAYER_ID,
  STATION_LABEL_INSIDE_FILTER,
  STATION_LABEL_INSIDE_LAYER_ID,
  STATION_LABEL_INSIDE_TEXT_FIELD,
  STATION_LABEL_TEXT_FIELD,
  STATION_LAYER_ID,
  STATION_SOURCE_ID,
  stationsToGeoJSON,
} from "./stationLayer";
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
  onLocate: (position: Coordinates) => void;
  onLocateError?: (message: string) => void;
  onPoiSelect?: (poi: POI) => void;
  /** Hands App a function to programmatically trigger geolocation (for the "Use current location" button). */
  onLocateReady?: (locate: () => void) => void;
}

export function MapView({
  stations,
  destination,
  origin,
  userLocation,
  selectedRoute,
  onLocate,
  onLocateError,
  onPoiSelect,
  onLocateReady,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { mapRef, isLoaded, locate } = useMapboxMap(containerRef, { onLocate, onLocateError, onPoiSelect });
  const destinationMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const originMarkerRef = useRef<mapboxgl.Marker | null>(null);

  useEffect(() => {
    onLocateReady?.(locate);
  }, [locate, onLocateReady]);

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
      paint: {
        "circle-radius": STATION_CIRCLE_RADIUS,
        "circle-color": STATION_CIRCLE_COLOR,
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "#ffffff",
      },
    });
    // Count labels in three tiers (all always-shown so the base style's dense labels can't drop
    // them). Wrapped defensively — enrichment must never take down the core map/route layers.
    // - external: only the nearest few stations, number floated ABOVE the dot, when zoomed out.
    // - inside: every station, number centered INSIDE the enlarged dot, once zoomed in (14+).
    // - detail: manual/electric/docks broken out BELOW the dot, when very close (17+).
    try {
      const alwaysShow = { "text-allow-overlap": true, "text-ignore-placement": true } as const;
      map.addLayer({
        id: STATION_LABEL_EXTERNAL_LAYER_ID,
        type: "symbol",
        source: STATION_SOURCE_ID,
        maxzoom: INSIDE_LABEL_MINZOOM,
        filter: STATION_LABEL_EXTERNAL_FILTER,
        layout: {
          "text-field": STATION_LABEL_TEXT_FIELD,
          "text-size": 12,
          "text-anchor": "bottom",
          "text-offset": [0, -0.6],
          ...alwaysShow,
        },
        paint: { "text-color": "#ffffff", "text-halo-color": "rgba(0, 0, 0, 0.7)", "text-halo-width": 1.6 },
      });
      map.addLayer({
        id: STATION_LABEL_INSIDE_LAYER_ID,
        type: "symbol",
        source: STATION_SOURCE_ID,
        minzoom: INSIDE_LABEL_MINZOOM,
        filter: STATION_LABEL_INSIDE_FILTER,
        layout: {
          "text-field": STATION_LABEL_INSIDE_TEXT_FIELD,
          "text-size": ["interpolate", ["linear"], ["zoom"], 14, 11, 17, 15],
          ...alwaysShow,
        },
        paint: { "text-color": "#ffffff", "text-halo-color": "rgba(0, 0, 0, 0.25)", "text-halo-width": 0.8 },
      });
      map.addLayer({
        id: STATION_LABEL_DETAIL_LAYER_ID,
        type: "symbol",
        source: STATION_SOURCE_ID,
        minzoom: DETAIL_LABEL_MINZOOM,
        filter: STATION_LABEL_DETAIL_FILTER,
        layout: {
          "text-field": STATION_LABEL_DETAIL_TEXT_FIELD,
          "text-size": 11,
          "text-anchor": "top",
          "text-offset": [0, 1.4],
          ...alwaysShow,
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

    // Route line source/layer — walk legs dashed, bike leg solid, styled distinctly so the
    // three-part trip reads at a glance. Added empty; populated by the effect below.
    map.addSource(ROUTE_SOURCE_ID, { type: "geojson", data: EMPTY_ROUTE_GEOJSON });
    map.addLayer(
      {
        id: ROUTE_LAYER_ID,
        type: "line",
        source: ROUTE_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["match", ["get", "mode"], "bike", "#2e7d32", "#1976d2"],
          "line-width": 4,
          "line-dasharray": ["case", ["==", ["get", "mode"], "walk"], ["literal", [2, 2]], ["literal", [1, 0]]],
        },
      },
      STATION_LAYER_ID, // insert below the station dots so they stay tappable/visible on top
    );
  }, [isLoaded, mapRef]);

  // Push updated live data into the source whenever `stations` changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoaded) return;
    const source = map.getSource(STATION_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    const destinationCoords = destination ? { lat: destination.lat, lon: destination.lon } : null;
    source?.setData(stationsToGeoJSON(stations, userLocation, destinationCoords));
  }, [stations, userLocation, destination, isLoaded, mapRef]);

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
      destinationMarkerRef.current = new mapboxgl.Marker({ color: "#1976d2" }).setLngLat(lngLat).addTo(map);
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
