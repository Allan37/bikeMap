import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef } from "react";
import type { Coordinates, POI, RouteOption, Station } from "../types";
import { EMPTY_ROUTE_GEOJSON, ROUTE_LAYER_ID, ROUTE_SOURCE_ID, routeOptionToGeoJSON } from "./routeLayer";
import { STATION_CIRCLE_COLOR, STATION_LAYER_ID, STATION_SOURCE_ID, stationsToGeoJSON } from "./stationLayer";
import { useMapboxMap } from "./useMapboxMap";

interface MapViewProps {
  stations: Station[];
  destination: POI | null;
  selectedRoute: RouteOption | null;
  onLocate: (position: Coordinates) => void;
}

export function MapView({ stations, destination, selectedRoute, onLocate }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { mapRef, isLoaded } = useMapboxMap(containerRef, onLocate);
  const destinationMarkerRef = useRef<mapboxgl.Marker | null>(null);

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
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3, 16, 8],
        "circle-color": STATION_CIRCLE_COLOR,
        "circle-stroke-width": 1,
        "circle-stroke-color": "#ffffff",
      },
    });
    // Overlay a white "x" on dead stations (0 bikes and 0 docks) — a redundant signal on
    // top of color alone, so it's not just "which shade of dark is this" at a glance.
    map.addLayer({
      id: `${STATION_LAYER_ID}-dead-marker`,
      type: "symbol",
      source: STATION_SOURCE_ID,
      filter: ["==", ["get", "availability"], "dead"],
      layout: {
        "text-field": "✕",
        "text-size": ["interpolate", ["linear"], ["zoom"], 11, 6, 16, 12],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": "#ffffff",
      },
    });

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
        ebikesAvailable > 0 ? `${bikesAvailable} bikes (${standardBikes} standard, ${ebikesAvailable} electric)` : `${bikesAvailable} bikes`;
      new mapboxgl.Popup({ closeButton: true, offset: 10 })
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
    source?.setData(stationsToGeoJSON(stations));
  }, [stations, isLoaded, mapRef]);

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
      map.fitBounds(bounds, { padding: 60 });
    }
  }, [selectedRoute, isLoaded, mapRef]);

  return <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />;
}
