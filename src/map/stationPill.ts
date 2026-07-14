import type { StationMode } from "./stationLayer";

// Lucide-derived glyphs as inline SVG (no icon runtime for HTML markers). The e-bike glyph is a
// custom composite: the Lucide bike stacked on top of a sideways Lucide bolt.
const svg = (paths: string, color: string, klass: string) =>
  `<svg class="${klass}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

const BIKE_PATHS = `<circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/>`;
const BOLT_PATHS = `<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>`;
const PARKING_PATHS = `<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/>`;

const BIKE_ICON = svg(BIKE_PATHS, "#2e7d32", "pill-ico");
const PARK_ICON = svg(PARKING_PATHS, "#1976d2", "pill-ico");
// Bike on top of a sideways bolt.
const EBIKE_ICON = `<span class="pill-ebike">${svg(BIKE_PATHS, "#2e7d32", "pill-ico pill-ico-sm")}${svg(BOLT_PATHS, "#f9a825", "pill-ico pill-bolt")}</span>`;

/** Inner HTML for a station's count pill, given its live counts and the current mode. */
export function stationPillHTML(
  bikes: number,
  ebikes: number,
  docks: number,
  availability: string,
  mode: StationMode,
): string {
  if (availability === "dead") return `<span class="pill-dead">✕</span>`;
  if (mode === "park") {
    return `<span class="pill-seg">${PARK_ICON}<span class="pill-num">${docks}</span></span>`;
  }
  const manual = Math.max(0, bikes - ebikes);
  return (
    `<span class="pill-seg">${BIKE_ICON}<span class="pill-num">${manual}</span></span>` +
    `<span class="pill-seg">${EBIKE_ICON}<span class="pill-num">${ebikes}</span></span>`
  );
}
