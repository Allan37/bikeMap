import mapboxgl from "mapbox-gl";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, MAPBOX_TOKEN, MAP_STYLE, MAP_STYLE_CONFIG } from "../config";

mapboxgl.accessToken = MAPBOX_TOKEN;

/** Creates a mapbox-gl map instance on the given container ref and tears it down on unmount. */
export function useMapboxMap(containerRef: React.RefObject<HTMLDivElement | null>) {
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      config: MAP_STYLE_CONFIG,
      center: DEFAULT_MAP_CENTER,
      zoom: DEFAULT_MAP_ZOOM,
    });
    // Pinch-to-zoom covers zooming on mobile; the on-screen +/- buttons mostly just take up
    // space on a touch device. Keep the compass/reset-bearing button since two-finger
    // rotate has no other obvious "undo" affordance.
    map.addControl(new mapboxgl.NavigationControl({ showZoom: false }), "top-right");
    map.on("load", () => setIsLoaded(true));
    mapRef.current = map;
    if (import.meta.env.DEV) (window as any).__debugMap = map; // dev-only inspection hook

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // containerRef identity is stable for the component's lifetime; this should run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { mapRef, isLoaded };
}
