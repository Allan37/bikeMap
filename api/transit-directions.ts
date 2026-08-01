import type { VercelRequest, VercelResponse } from "@vercel/node";

// Logic is inlined (rather than importing ./_transitProxy) so this serverless function has no local
// imports — Vercel's bundler mishandled that before. The dev-server middleware uses _transitProxy.ts.
const DIRECTIONS_URL = "https://maps.googleapis.com/maps/api/directions/json";
const UPSTREAM_TIMEOUT_MS = 10_000;
const TRANSIT_CACHE_TTL_MS = 60_000;

interface CachedRoute {
  expiresAt: number;
  route: unknown;
}

// Best-effort cache: Vercel may reuse a warm function instance, but correctness never depends on it.
const routeCache = new Map<string, CachedRoute>();

function sendError(res: VercelResponse, status: number, code: string, message: string) {
  res.status(status).json({ error: { code, message } });
}

function parseCoordinate(value: string | string[] | undefined, min: number, max: number): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function routeCacheKey(originLat: number, originLon: number, destLat: number, destLon: number): string {
  // ~1 m precision keeps repeated UI requests together without conflating meaningfully different trips.
  return [originLat, originLon, destLat, destLon].map((n) => n.toFixed(5)).join(",");
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Upstream request timed out");
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { originLat, originLon, destLat, destLon } = req.query;
  const originLatitude = parseCoordinate(originLat, -90, 90);
  const originLongitude = parseCoordinate(originLon, -180, 180);
  const destLatitude = parseCoordinate(destLat, -90, 90);
  const destLongitude = parseCoordinate(destLon, -180, 180);
  if (originLatitude === null || originLongitude === null || destLatitude === null || destLongitude === null) {
    sendError(
      res,
      400,
      "INVALID_COORDINATES",
      "originLat, originLon, destLat, and destLon must be finite coordinates within their valid ranges",
    );
    return;
  }

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    sendError(res, 500, "SERVER_MISCONFIGURED", "Transit directions are not configured on the server");
    return;
  }

  const cacheKey = routeCacheKey(originLatitude, originLongitude, destLatitude, destLongitude);
  const cached = routeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    res.setHeader("Cache-Control", "private, max-age=60");
    res.status(200).json({ route: cached.route });
    return;
  }
  routeCache.delete(cacheKey);

  try {
    const params = new URLSearchParams({
      origin: `${originLatitude},${originLongitude}`,
      destination: `${destLatitude},${destLongitude}`,
      mode: "transit",
      transit_mode: "subway|train|tram",
      key,
    });
    const response = await fetchWithTimeout(`${DIRECTIONS_URL}?${params}`);
    if (!response.ok) {
      sendError(res, 502, "UPSTREAM_ERROR", `Transit directions failed (${response.status})`);
      return;
    }

    // biome-ignore lint/suspicious/noExplicitAny: Google's response is deeply nested and untyped here.
    const data = (await response.json()) as any;
    if (data.status !== "OK") {
      res.status(200).json({ route: null });
      return;
    }
    const leg = data.routes?.[0]?.legs?.[0];
    if (!leg) {
      res.status(200).json({ route: null });
      return;
    }

    // biome-ignore lint/suspicious/noExplicitAny: see above.
    const steps = (leg.steps ?? []).map((s: any) => {
      const polyline = s.polyline?.points ?? null;
      if (s.travel_mode === "TRANSIT" && s.transit_details) {
        const td = s.transit_details;
        const line = td.line ?? {};
        const toCoords = (loc: { lat?: number; lng?: number } | undefined) =>
          loc && typeof loc.lat === "number" && typeof loc.lng === "number" ? { lat: loc.lat, lon: loc.lng } : null;
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
          departureCoords: toCoords(td.departure_stop?.location),
          arrivalCoords: toCoords(td.arrival_stop?.location),
          polyline,
        };
      }
      return {
        kind: "walk",
        durationSeconds: s.duration?.value ?? 0,
        instruction: stripHtml(s.html_instructions ?? "Walk"),
        polyline,
      };
    });

    const route = {
      totalDurationSeconds: leg.duration?.value ?? 0,
      departureText: leg.departure_time?.text ?? null,
      arrivalText: leg.arrival_time?.text ?? null,
      steps,
    };
    routeCache.set(cacheKey, { route, expiresAt: Date.now() + TRANSIT_CACHE_TTL_MS });
    res.setHeader("Cache-Control", "private, max-age=60");
    res.status(200).json({ route });
  } catch (err) {
    const timedOut = err instanceof Error && err.message === "Upstream request timed out";
    sendError(
      res,
      timedOut ? 504 : 502,
      timedOut ? "UPSTREAM_TIMEOUT" : "UPSTREAM_ERROR",
      timedOut ? "Transit directions request timed out" : "Transit directions failed",
    );
  }
}
