import mapboxgl from "mapbox-gl";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, MAPBOX_TOKEN } from "../config";

mapboxgl.accessToken = MAPBOX_TOKEN;

/** Creates a mapbox-gl map instance on the given container ref and tears it down on unmount. */
export function useMapboxMap(containerRef: React.RefObject<HTMLDivElement | null>) {
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: DEFAULT_MAP_CENTER,
      zoom: DEFAULT_MAP_ZOOM,
    });
    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    map.on("load", () => setIsLoaded(true));
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // containerRef identity is stable for the component's lifetime; this should run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { mapRef, isLoaded };
}
