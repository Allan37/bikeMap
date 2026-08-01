import type { VercelRequest, VercelResponse } from "@vercel/node";

// The Yelp fetch is inlined here (rather than importing ./_yelpProxy) so this serverless function
// has zero local imports — Vercel's function bundler was failing to include the shared module,
// crashing the function on invocation (FUNCTION_INVOCATION_FAILED). The dev-server middleware in
// vite.config.ts still uses _yelpProxy.ts for the same logic; keep the two in sync.
const YELP_BASE_URL = "https://api.yelp.com/v3";
const UPSTREAM_TIMEOUT_MS = 10_000;
const MAX_TERM_LENGTH = 160;

function sendError(res: VercelResponse, status: number, code: string, message: string) {
  res.status(status).json({ error: { code, message } });
}

function parseCoordinate(value: string | string[] | undefined, min: number, max: number): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Upstream request timed out");
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { lat, lon, term } = req.query;
  const latitude = parseCoordinate(lat, -90, 90);
  const longitude = parseCoordinate(lon, -180, 180);
  if (latitude === null || longitude === null) {
    sendError(res, 400, "INVALID_COORDINATES", "lat and lon must be finite coordinates within their valid ranges");
    return;
  }
  if (term !== undefined && (typeof term !== "string" || term.length > MAX_TERM_LENGTH)) {
    sendError(res, 400, "INVALID_TERM", `term must be a string no longer than ${MAX_TERM_LENGTH} characters`);
    return;
  }

  const apiKey = process.env.YELP_API_KEY;
  if (!apiKey) {
    sendError(res, 500, "SERVER_MISCONFIGURED", "Yelp is not configured on the server");
    return;
  }

  try {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      limit: "3",
      sort_by: "best_match",
    });
    if (term) params.set("term", term);

    const response = await fetchWithTimeout(`${YELP_BASE_URL}/businesses/search?${params}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      sendError(res, 502, "UPSTREAM_ERROR", `Yelp search failed (${response.status})`);
      return;
    }
    res.status(200).json(await response.json());
  } catch (err) {
    const timedOut = err instanceof Error && err.message === "Upstream request timed out";
    sendError(res, timedOut ? 504 : 502, timedOut ? "UPSTREAM_TIMEOUT" : "UPSTREAM_ERROR", timedOut ? "Yelp request timed out" : "Yelp search failed");
  }
}
