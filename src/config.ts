/** Mapbox access token — public/URL-restricted, safe to expose client-side. */
export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string;

/**
 * Citibike's public GBFS feed for NYC. No API key required.
 * Discovered via https://gbfs.citibikenyc.com/gbfs/gbfs.json, which points here.
 */
export const GBFS_BASE_URL = "https://gbfs.lyft.com/gbfs/1.1/bkn/en";
export const STATION_INFORMATION_URL = `${GBFS_BASE_URL}/station_information.json`;
export const STATION_STATUS_URL = `${GBFS_BASE_URL}/station_status.json`;

/** How often to re-poll live station status. GBFS itself refreshes roughly every 30-60s. */
export const STATION_STATUS_POLL_INTERVAL_MS = 30_000;

/** Default map center — NYC, roughly Manhattan. Overridden by geolocation once available. */
export const DEFAULT_MAP_CENTER: [number, number] = [-73.98, 40.75];
export const DEFAULT_MAP_ZOOM = 13;

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
