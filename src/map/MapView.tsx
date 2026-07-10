import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef } from "react";
import type { Station } from "../types";
import { STATION_CIRCLE_COLOR, STATION_LAYER_ID, STATION_SOURCE_ID, stationsToGeoJSON } from "./stationLayer";
import { useMapboxMap } from "./useMapboxMap";

interface MapViewProps {
  stations: Station[];
}

export function MapView({ stations }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { mapRef, isLoaded } = useMapboxMap(containerRef);
  const popupRef = useRef<mapboxgl.Popup | null>(null);

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

    const popup = new mapboxgl.Popup({ closeButton: false, offset: 10 });
    popupRef.current = popup;

    map.on("mouseenter", STATION_LAYER_ID, (e) => {
      map.getCanvas().style.cursor = "pointer";
      const feature = e.features?.[0];
      if (!feature || feature.geometry.type !== "Point") return;
      const { name, bikesAvailable, docksAvailable } = feature.properties as {
        name: string;
        bikesAvailable: number;
        docksAvailable: number;
      };
      popup
        .setLngLat(feature.geometry.coordinates as [number, number])
        .setHTML(`<strong>${name}</strong><br/>${bikesAvailable} bikes · ${docksAvailable} docks`)
        .addTo(map);
    });
    map.on("mouseleave", STATION_LAYER_ID, () => {
      map.getCanvas().style.cursor = "";
      popup.remove();
    });
  }, [isLoaded, mapRef]);

  // Push updated live data into the source whenever `stations` changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoaded) return;
    const source = map.getSource(STATION_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    source?.setData(stationsToGeoJSON(stations));
  }, [stations, isLoaded, mapRef]);

  return <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />;
}
