import type { ExpressionSpecification, Map as MapboxMap } from "mapbox-gl";

export const SUBWAY_LINES_SOURCE_ID = "subway-lines";
export const SUBWAY_LINES_LAYER_ID = "subway-lines-layer";

/** Official MTA trunk-line colors, keyed by the dataset's trunk symbol. */
const TRUNK_COLORS: Record<string, string> = {
  "1": "#EE352E", // 1/2/3
  "4": "#00933C", // 4/5/6
  "7": "#B933AD", // 7
  A: "#0039A6", // A/C/E
  B: "#FF6319", // B/D/F/M
  G: "#6CBE45", // G
  J: "#996633", // J/Z
  L: "#A7A9AC", // L
  N: "#FCCC0A", // N/Q/R/W
};

/**
 * Fetches the bundled NYC subway line geometry (public/data/subway-lines.json — the classic NYC
 * Open Data "Subway Lines" dataset dissolved by trunk, ~9 features) and draws it as a subtle
 * colored overlay beneath the Citibike station layer. Fetched at runtime rather than bundled so
 * the JS stays lean and the service worker can cache it.
 */
export async function addSubwayLinesOverlay(map: MapboxMap, beforeLayerId: string): Promise<void> {
  const response = await fetch("/data/subway-lines.json");
  if (!response.ok) throw new Error(`subway lines fetch failed: ${response.status}`);
  const data = (await response.json()) as GeoJSON.FeatureCollection;

  if (map.getSource(SUBWAY_LINES_SOURCE_ID)) return;
  map.addSource(SUBWAY_LINES_SOURCE_ID, { type: "geojson", data });
  map.addLayer(
    {
      id: SUBWAY_LINES_LAYER_ID,
      type: "line",
      source: SUBWAY_LINES_SOURCE_ID,
      minzoom: 10,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["match", ["get", "trunk"], ...Object.entries(TRUNK_COLORS).flat(), "#808183"] as ExpressionSpecification,
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.2, 14, 2.2, 16, 3.5],
        "line-opacity": 0.55,
      },
    },
    beforeLayerId,
  );
}
