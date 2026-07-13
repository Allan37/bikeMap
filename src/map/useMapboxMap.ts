import mapboxgl from "mapbox-gl";
import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, MAPBOX_TOKEN, MAP_STYLE, MAP_STYLE_CONFIG } from "../config";
import type { Coordinates, POI } from "../types";

mapboxgl.accessToken = MAPBOX_TOKEN;

interface UseMapboxMapCallbacks {
  onLocate?: (position: Coordinates) => void;
  onLocateError?: (message: string) => void;
  /** Fired when the user taps a POI label baked into the base map (a restaurant, shop, etc.). */
  onPoiSelect?: (poi: POI) => void;
}

/** Creates a mapbox-gl map instance on the given container ref and tears it down on unmount. */
export function useMapboxMap(containerRef: React.RefObject<HTMLDivElement | null>, callbacks: UseMapboxMapCallbacks = {}) {
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const geolocateRef = useRef<mapboxgl.GeolocateControl | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  // Held in a ref so new callback identities each render don't recreate the map.
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  /** Programmatically kicks off geolocation (same as tapping the on-map locate button). */
  const locate = useCallback(() => {
    geolocateRef.current?.trigger();
  }, []);

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
    map.on("load", () => {
      setIsLoaded(true);
      // Standalone iOS PWAs launch with no resize event, so the canvas can be measured before the
      // safe-area layout settles — leaving a strip of page background at the bottom. Re-measure.
      map.resize();
      setTimeout(() => map.resize(), 300);
    });
    mapRef.current = map;
    if (import.meta.env.DEV) (window as any).__debugMap = map; // dev-only inspection hook

    // Tap any base-map POI label (restaurants, shops, etc.) to make it the destination. The
    // Standard style exposes these via the `poi` featureset rather than a queryable layer.
    map.addInteraction("poi-click", {
      type: "click",
      target: { featuresetId: "poi", importId: "basemap" },
      handler: (e) => {
        const feature = e.feature;
        const name = feature?.properties?.name;
        if (!feature || typeof name !== "string" || feature.geometry.type !== "Point") return;
        const [lon, lat] = feature.geometry.coordinates as [number, number];
        callbacksRef.current.onPoiSelect?.({ name, placeFormatted: "", lat, lon });
      },
    });

    // The GeolocateControl is used purely as the "locate me" button + permission/error handler —
    // showUserLocation:false means it draws no dot of its own, so we can render our own dot below
    // and drive its cadence (see the tracking loop) independently of mapbox's internal watch.
    const geolocate = new mapboxgl.GeolocateControl({
      // A bounded timeout matters on mobile: without it a device that can't get a high-accuracy
      // fix hangs indefinitely, and mapbox then parks the control in its slashed "off" state.
      positionOptions: { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
      trackUserLocation: false,
      showUserLocation: false,
    });

    // --- Live dot + adaptive tracking ------------------------------------------------------
    // We draw our own dot so we can decouple two cadences: the dot follows on a gentle ~5s loop
    // while the tab is visible, but a fresh fix is only pushed into routing (onLocate) every ~30s,
    // so route options don't churn as you walk. Tracking pauses whenever Safari is backgrounded.
    const DOT_INTERVAL_MS = 5000;
    const ROUTING_MIN_INTERVAL_MS = 30000;
    // .user-dot is the marker element mapbox positions (don't animate its transform); the cone and
    // the pulsing blue core are children so their own transforms/animations don't fight positioning.
    const dotElement = document.createElement("div");
    dotElement.className = "user-dot";
    const coneElement = document.createElement("div");
    coneElement.className = "user-dot-cone";
    const coreElement = document.createElement("div"); // fixed white ring
    coreElement.className = "user-dot-core";
    const centerElement = document.createElement("div"); // pulsing blue center
    centerElement.className = "user-dot-center";
    coreElement.appendChild(centerElement);
    dotElement.append(coneElement, coreElement);
    const dotMarker = new mapboxgl.Marker({ element: dotElement });
    let dotAdded = false;
    let lastRoutingPush = 0;
    let trackingTimer: number | undefined;
    let trackingEnabled = false;

    const showDot = (lat: number, lon: number) => {
      dotMarker.setLngLat([lon, lat]);
      if (!dotAdded) {
        dotMarker.addTo(map);
        dotAdded = true;
      }
    };
    // force=true for user-initiated fixes so routing updates immediately; the periodic loop
    // otherwise only feeds routing once per ROUTING_MIN_INTERVAL_MS.
    const pushToRouting = (lat: number, lon: number, force = false) => {
      const now = Date.now();
      if (force || now - lastRoutingPush >= ROUTING_MIN_INTERVAL_MS) {
        lastRoutingPush = now;
        callbacksRef.current.onLocate?.({ lat, lon });
      }
    };
    const stopTracking = () => {
      if (trackingTimer != null) {
        clearInterval(trackingTimer);
        trackingTimer = undefined;
      }
    };
    const startTracking = () => {
      if (!trackingEnabled || trackingTimer != null || document.hidden) return;
      trackingTimer = window.setInterval(() => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            showDot(pos.coords.latitude, pos.coords.longitude);
            pushToRouting(pos.coords.latitude, pos.coords.longitude);
          },
          (err) => {
            // Permission revoked mid-session → stop pinging; otherwise it's a transient miss, keep
            // the last dot and try again on the next tick.
            if (err.code === err.PERMISSION_DENIED) stopTracking();
          },
          { enableHighAccuracy: true, maximumAge: 4000, timeout: 8000 },
        );
      }, DOT_INTERVAL_MS);
    };
    // Stop the GPS loop while Safari is backgrounded (e.g. after handing the ride to Apple Maps),
    // resume it on return.
    const onVisibilityChange = () => (document.hidden ? stopTracking() : startTracking());
    document.addEventListener("visibilitychange", onVisibilityChange);

    // --- Compass heading (which way you're facing) ------------------------------------------
    // iOS gates DeviceOrientation behind a permission that must be requested from a user gesture,
    // so we lazily request it on the first tap anywhere, then rotate a wedge on the dot to heading.
    let headingEnabled = false;
    const onOrientation = (e: DeviceOrientationEvent) => {
      const compass = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
      const heading = typeof compass === "number" ? compass : typeof e.alpha === "number" ? 360 - e.alpha : null;
      if (heading == null) return;
      dotElement.classList.add("user-dot--has-heading");
      // Subtract the map's bearing so the wedge stays correct even if the map is rotated.
      coneElement.style.transform = `rotate(${heading - map.getBearing()}deg)`;
    };
    const enableHeading = () => {
      if (headingEnabled) return;
      headingEnabled = true;
      const DOE = window.DeviceOrientationEvent as
        | (typeof DeviceOrientationEvent & { requestPermission?: () => Promise<"granted" | "denied"> })
        | undefined;
      const start = () => window.addEventListener("deviceorientation", onOrientation);
      if (DOE && typeof DOE.requestPermission === "function") {
        DOE.requestPermission()
          .then((res) => {
            if (res === "granted") start();
          })
          .catch(() => {});
      } else {
        start(); // Android / non-iOS: no permission gate
      }
    };
    // iOS only shows the permission dialog from an activation gesture. Listen on both a tap (click)
    // and touchend so panning/pinch-zooming the map also triggers it, not only tapping a control.
    const onFirstGesture = () => enableHeading();
    window.addEventListener("click", onFirstGesture, { once: true, capture: true });
    window.addEventListener("touchend", onFirstGesture, { once: true, capture: true });

    geolocate.on("geolocate", (position: GeolocationPosition) => {
      const { latitude, longitude } = position.coords;
      showDot(latitude, longitude);
      pushToRouting(latitude, longitude, true); // user asked to locate — update routing now
      map.flyTo({ center: [longitude, latitude] }); // recenter only on an explicit locate, not the loop
      trackingEnabled = true;
      startTracking();
    });
    // Without a handler mapbox just greys the button (the "slash" state) with no explanation.
    // Surface why so the user can act (e.g. re-enable location permission for the site).
    geolocate.on("error", async (err: GeolocationPositionError) => {
      // Log the raw facts so an unexpected denial can be diagnosed from the console.
      let permissionState = "unqueryable";
      try {
        permissionState = (await navigator.permissions?.query({ name: "geolocation" as PermissionName }))?.state ?? "unqueryable";
      } catch {
        // Safari historically can't query the geolocation permission — leave it as unqueryable.
      }
      console.warn("[bikeMap] geolocation error", {
        code: err.code,
        message: err.message,
        secureContext: window.isSecureContext,
        permissionState,
      });

      // A non-HTTPS origin (e.g. the LAN http://…:5173 URL on a phone) makes browsers block
      // geolocation and report it as "denied" — call that out specifically so it isn't mistaken
      // for a Safari permission setting the user has actually already granted.
      const message = !window.isSecureContext
        ? "Location needs a secure (https://) page. On your phone, open the https tunnel URL, not the http LAN address."
        : err.code === err.PERMISSION_DENIED
          ? // The per-site "aA → Website Settings → Location" grant is only one of several iOS layers.
            // When that's already allowed, the block is almost always Private Browsing or the system
            // Location Services → Safari Websites toggle, so point at those.
            "Safari is blocking location. Turn off Private Browsing, and set Settings ▸ Privacy & Security ▸ Location Services ▸ Safari Websites to “While Using”. Then reload."
          : err.code === err.TIMEOUT
            ? "Couldn't get a location fix (timed out). Try again with a clearer view of the sky."
            : "Location unavailable right now. Try again in a moment.";
      // Raw diagnostic appended so it's readable on a phone (no console needed) — report this back
      // if the setting fixes above don't help, and it pins the cause exactly.
      const diagnostic = `[diag code=${err.code} secure=${window.isSecureContext} perm=${permissionState} https=${location.protocol === "https:"}]`;
      callbacksRef.current.onLocateError?.(`${message}\n${diagnostic}`);
      // On a PERMISSION_DENIED, mapbox disables the button for the life of the page and never
      // re-enables it — so once it errors (even a stale/earlier denial) it's a dead control even
      // after the user grants permission. Re-enable it so the next tap actually retries.
      const button = map.getContainer().querySelector<HTMLButtonElement>("button.mapboxgl-ctrl-geolocate");
      if (button) button.disabled = false;
    });
    map.addControl(geolocate, "bottom-right");
    geolocateRef.current = geolocate;

    // If location was granted on a previous visit, drop the dot automatically on load — no tap,
    // and (already granted) no prompt. First-time visitors still tap the button, which gives the
    // user gesture browsers want for the initial permission request. Older Safari can't query the
    // geolocation permission; there we just fall back to the manual tap.
    navigator.permissions
      ?.query({ name: "geolocation" as PermissionName })
      .then((status) => {
        if (status.state === "granted") geolocate.trigger();
      })
      .catch(() => {});

    return () => {
      stopTracking();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("deviceorientation", onOrientation);
      window.removeEventListener("click", onFirstGesture, { capture: true });
      window.removeEventListener("touchend", onFirstGesture, { capture: true });
      map.remove();
      mapRef.current = null;
      geolocateRef.current = null;
    };
    // containerRef identity is stable for the component's lifetime; this should run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { mapRef, isLoaded, locate };
}
