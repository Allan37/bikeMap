import type { POI } from "../types";

// Saved places live only in this browser's localStorage — never in the repo, the deployed bundle,
// or a server. On an installed (Home-Screen) PWA this persists indefinitely; it's cleared only by
// removing the app, clearing site data, or clearing it in-app.
const STORAGE_KEY = "bikemap.savedPlaces.v1";
const MAX_RECENTS = 5;

export type SavedKind = "home" | "work";

export interface SavedPlacesState {
  home?: POI;
  work?: POI;
  recents: POI[];
}

function read(): SavedPlacesState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { recents: [], ...(JSON.parse(raw) as Partial<SavedPlacesState>) };
  } catch {
    // Corrupt/unavailable storage — fall back to empty rather than throwing.
  }
  return { recents: [] };
}

function write(state: SavedPlacesState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private mode / quota — silently skip; the app still works without persistence.
  }
}

export function getSavedPlaces(): SavedPlacesState {
  return read();
}

export function setSavedPlace(kind: SavedKind, poi: POI): void {
  const state = read();
  state[kind] = poi;
  write(state);
}

export function clearSavedPlace(kind: SavedKind): void {
  const state = read();
  delete state[kind];
  write(state);
}

/** Most-recently chosen destinations, newest first, de-duplicated by coordinates. */
export function addRecent(poi: POI): void {
  const state = read();
  const deduped = state.recents.filter((r) => r.lat !== poi.lat || r.lon !== poi.lon);
  state.recents = [poi, ...deduped].slice(0, MAX_RECENTS);
  write(state);
}
