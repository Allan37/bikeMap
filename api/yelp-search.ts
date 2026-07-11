import type { VercelRequest, VercelResponse } from "@vercel/node";

// The Yelp fetch is inlined here (rather than importing ./_yelpProxy) so this serverless function
// has zero local imports — Vercel's function bundler was failing to include the shared module,
// crashing the function on invocation (FUNCTION_INVOCATION_FAILED). The dev-server middleware in
// vite.config.ts still uses _yelpProxy.ts for the same logic; keep the two in sync.
const YELP_BASE_URL = "https://api.yelp.com/v3";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { lat, lon, term } = req.query;
  if (typeof lat !== "string" || typeof lon !== "string") {
    res.status(400).json({ error: "lat and lon query params are required" });
    return;
  }

  const apiKey = process.env.YELP_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "YELP_API_KEY is not configured on the server" });
    return;
  }

  try {
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      limit: "3",
      sort_by: "best_match",
    });
    if (typeof term === "string") params.set("term", term);

    const response = await fetch(`${YELP_BASE_URL}/businesses/search?${params}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      res.status(502).json({ error: `Yelp search failed: ${response.status}` });
      return;
    }
    res.status(200).json(await response.json());
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Yelp search failed" });
  }
}
