import { MAPBOX_TOKEN } from "../config";
import type { POI } from "../types";

const SEARCH_BASE_URL = "https://api.mapbox.com/search/searchbox/v1";

// NYC-ish bounding box, biases results toward the five boroughs (this app has no reason
// to surface a "Broadway" in another city).
const NYC_BBOX = "-74.26,40.49,-73.68,40.92";

export interface PlaceSuggestion {
  mapboxId: string;
  name: string;
  placeFormatted: string;
}

interface RawSuggestion {
  mapbox_id: string;
  name: string;
  place_formatted: string;
}

interface RawRetrieveFeature {
  properties: {
    name: string;
    place_formatted?: string;
    coordinates: { longitude: number; latitude: number };
  };
}

/**
 * Fetches autocomplete suggestions for a query. `sessionToken` should be a single UUID
 * reused across one suggest→retrieve search flow (Mapbox bills per session, not per request).
 */
export async function searchSuggestions(query: string, sessionToken: string): Promise<PlaceSuggestion[]> {
  if (!query.trim()) return [];

  const params = new URLSearchParams({
    q: query,
    session_token: sessionToken,
    access_token: MAPBOX_TOKEN,
    bbox: NYC_BBOX,
    limit: "6",
  });
  const response = await fetch(`${SEARCH_BASE_URL}/suggest?${params}`);
  if (!response.ok) {
    throw new Error(`Search suggest failed: ${response.status}`);
  }
  const body = (await response.json()) as { suggestions: RawSuggestion[] };
  return body.suggestions.map((s) => ({
    mapboxId: s.mapbox_id,
    name: s.name,
    placeFormatted: s.place_formatted,
  }));
}

/** Resolves a suggestion (by mapbox_id) into full coordinates. Same sessionToken as the suggest call. */
export async function retrievePlace(mapboxId: string, sessionToken: string): Promise<POI> {
  const params = new URLSearchParams({
    session_token: sessionToken,
    access_token: MAPBOX_TOKEN,
  });
  const response = await fetch(`${SEARCH_BASE_URL}/retrieve/${mapboxId}?${params}`);
  if (!response.ok) {
    throw new Error(`Search retrieve failed: ${response.status}`);
  }
  const body = (await response.json()) as { features: RawRetrieveFeature[] };
  const feature = body.features[0];
  if (!feature) {
    throw new Error("Search retrieve returned no results");
  }
  return {
    name: feature.properties.name,
    placeFormatted: feature.properties.place_formatted ?? "",
    lat: feature.properties.coordinates.latitude,
    lon: feature.properties.coordinates.longitude,
  };
}
