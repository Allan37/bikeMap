import mapboxgl from "mapbox-gl";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, MAPBOX_TOKEN, MAP_STYLE, MAP_STYLE_CONFIG } from "../config";
import type { Coordinates } from "../types";

mapboxgl.accessToken = MAPBOX_TOKEN;

/** Creates a mapbox-gl map instance on the given container ref and tears it down on unmount. */
export function useMapboxMap(containerRef: React.RefObject<HTMLDivElement | null>, onLocate?: (position: Coordinates) => void) {
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  // Held in a ref so a new onLocate identity each render doesn't recreate the map.
  const onLocateRef = useRef(onLocate);
  onLocateRef.current = onLocate;

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      config: MAP_STYLE_CONFIG,
      center: DEFAULT_MAP_CENTER,
      zoom: DEFAULT_MAP_ZOOM,
    });
    // No on-screen zoom/compass buttons — pinch-to-zoom and two-finger rotate (both on by
    // default) cover this on mobile without extra UI chrome.
    map.on("load", () => setIsLoaded(true));
    mapRef.current = map;
    if (import.meta.env.DEV) (window as any).__debugMap = map; // dev-only inspection hook

    // Handles the browser geolocation permission prompt, renders the standard pulsing
    // blue-dot marker with an accuracy circle, and keeps tracking as the user moves —
    // all built into mapbox-gl rather than hand-rolled.
    const geolocate = new mapboxgl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      showAccuracyCircle: true,
    });
    geolocate.on("geolocate", (position: GeolocationPosition) => {
      onLocateRef.current?.({ lat: position.coords.latitude, lon: position.coords.longitude });
    });
    map.addControl(geolocate, "bottom-right");

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // containerRef identity is stable for the component's lifetime; this should run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { mapRef, isLoaded };
}
