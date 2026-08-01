/**
 * Shared Yelp Fusion request logic, used by both the Vercel serverless function
 * (api/yelp-search.ts) and the local Vite dev-server middleware (vite.config.ts).
 * Yelp Fusion has no CORS support and this key isn't safe to expose client-side,
 * so this file must only ever run server-side — never import it from src/.
 */

const YELP_BASE_URL = "https://api.yelp.com/v3";
const UPSTREAM_TIMEOUT_MS = 10_000;

export interface YelpSearchParams {
  lat: number;
  lon: number;
  term?: string;
}

export async function searchYelpBusinesses({ lat, lon, term }: YelpSearchParams): Promise<unknown> {
  const apiKey = process.env.YELP_API_KEY;
  if (!apiKey) {
    throw new Error("YELP_API_KEY is not configured on the server");
  }

  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    limit: "3",
    sort_by: "best_match",
  });
  if (term) params.set("term", term);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${YELP_BASE_URL}/businesses/search?${params}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Upstream request timed out");
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
  if (!response.ok) {
    throw new Error(`Yelp search failed: ${response.status}`);
  }
  return response.json();
}
