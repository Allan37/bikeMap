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
