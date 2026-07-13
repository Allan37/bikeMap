/** Mapbox access token — public/URL-restricted, safe to expose client-side. */
export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string;

/**
 * Citibike's public GBFS feed for NYC. No API key required.
 * Discovered via https://gbfs.citibikenyc.com/gbfs/gbfs.json, which points here.
 */
export const GBFS_BASE_URL = "https://gbfs.lyft.com/gbfs/1.1/bkn/en";
export const STATION_INFORMATION_URL = `${GBFS_BASE_URL}/station_information.json`;
export const STATION_STATUS_URL = `${GBFS_BASE_URL}/station_status.json`;

/**
 * How often to re-poll live station status. Empirically confirmed (repeated HEAD requests
 * watching `last-modified`) that Citibike's GBFS feed regenerates server-side on a flat
 * 60-second cycle — polling faster than that cannot get fresher data, it just re-downloads
 * the same ~1MB snapshot. There's no API quota to worry about (it's a static file behind
 * CloudFront, not a metered API), so the tradeoff is purely bandwidth/battery vs. how
 * quickly a new snapshot gets picked up:
 * - Idle (just browsing, no active trip): loose poll, most of that ~1MB is wasted anyway.
 * - Active (destination + location both set — about to depart): tight poll, so a fresh
 *   snapshot lands within 15s rather than up to 30s of it actually updating server-side.
 */
export const STATION_STATUS_POLL_INTERVAL_IDLE_MS = 45_000;
export const STATION_STATUS_POLL_INTERVAL_ACTIVE_MS = 15_000;

/** Default map center — NYC, roughly Manhattan. Overridden by geolocation once available. */
export const DEFAULT_MAP_CENTER: [number, number] = [-73.98, 40.75];
// A touch past the zoom where dots show their count inside (INSIDE_LABEL_MINZOOM), so on load —
// centered on you once located — stations already read their bike counts.
export const DEFAULT_MAP_ZOOM = 15;

/**
 * Mapbox's "Standard" base style exposes color/density config knobs (unlike streets-v12,
 * which needs a full custom Studio style to retheme). Tuned here toward Apple Maps' warm,
 * low-clutter palette: cream land, white roads, soft sage parks, muted blue water, and far
 * fewer POI icons at a glance. See https://docs.mapbox.com/map-styles/reference/standard/
 */
export const MAP_STYLE = "mapbox://styles/mapbox/standard";
export const MAP_STYLE_CONFIG = {
  basemap: {
    lightPreset: "day",
    densityPointOfInterestLabels: 1,
    colorWater: "#a8d5e2",
    colorLand: "#f5f1e8",
    colorGreenspace: "#c9e2c3",
    colorRoads: "#ffffff",
  },
} as const;

/**
 * How many nearest-with-availability stations to consider per side when ranking routes.
 * Directions API calls scale with N (walk legs), not N² — see routing/candidateSearch.ts.
 */
export const CANDIDATE_STATION_COUNT = 3;

/** How many ranked route options to surface to the user. */
export const MAX_ROUTE_OPTIONS = 3;
