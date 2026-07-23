/**
 * Shared Google Directions (transit) request + parse, used by the Vite dev-server middleware
 * (vite.config.ts). The real Vercel function (api/transit-directions.ts) inlines the same logic so
 * it has no local imports — Vercel's function bundler mishandled our earlier shared import. Keep in sync.
 * The Google Maps Platform key isn't safe client-side, so this only ever runs server-side.
 */
const DIRECTIONS_URL = "https://maps.googleapis.com/maps/api/directions/json";

export interface TransitQuery {
  originLat: number;
  originLon: number;
  destLat: number;
  destLon: number;
}

export interface TransitStep {
  kind: "walk" | "transit";
  durationSeconds: number;
  instruction?: string; // walk steps
  line?: string; // transit: short name, e.g. "1", "A"
  lineColor?: string | null;
  vehicle?: string; // SUBWAY, BUS, TRAM, ...
  headsign?: string;
  departureStop?: string;
  arrivalStop?: string;
  numStops?: number;
}

export interface TransitRoute {
  totalDurationSeconds: number;
  departureText?: string | null;
  arrivalText?: string | null;
  steps: TransitStep[];
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchTransitRoute(q: TransitQuery): Promise<TransitRoute | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error("GOOGLE_MAPS_API_KEY is not configured on the server");

  const params = new URLSearchParams({
    origin: `${q.originLat},${q.originLon}`,
    destination: `${q.destLat},${q.destLon}`,
    mode: "transit",
    transit_mode: "subway|train|tram",
    key,
  });
  const response = await fetch(`${DIRECTIONS_URL}?${params}`);
  if (!response.ok) throw new Error(`Directions request failed: ${response.status}`);

  // biome-ignore lint/suspicious/noExplicitAny: Google's response is deeply nested and untyped here.
  const data = (await response.json()) as any;
  if (data.status !== "OK") return null;
  const leg = data.routes?.[0]?.legs?.[0];
  if (!leg) return null;

  // biome-ignore lint/suspicious/noExplicitAny: see above.
  const steps: TransitStep[] = (leg.steps ?? []).map((s: any) => {
    if (s.travel_mode === "TRANSIT" && s.transit_details) {
      const td = s.transit_details;
      const line = td.line ?? {};
      return {
        kind: "transit",
        durationSeconds: s.duration?.value ?? 0,
        line: line.short_name ?? line.name ?? "",
        lineColor: line.color ?? null,
        vehicle: line.vehicle?.type ?? "SUBWAY",
        headsign: td.headsign ?? "",
        departureStop: td.departure_stop?.name ?? "",
        arrivalStop: td.arrival_stop?.name ?? "",
        numStops: td.num_stops ?? 0,
      };
    }
    return { kind: "walk", durationSeconds: s.duration?.value ?? 0, instruction: stripHtml(s.html_instructions ?? "Walk") };
  });

  return {
    totalDurationSeconds: leg.duration?.value ?? 0,
    departureText: leg.departure_time?.text ?? null,
    arrivalText: leg.arrival_time?.text ?? null,
    steps,
  };
}
