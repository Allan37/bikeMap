import type { VercelRequest, VercelResponse } from "@vercel/node";
import { searchYelpBusinesses } from "./_yelpProxy";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { lat, lon, term } = req.query;
  if (typeof lat !== "string" || typeof lon !== "string") {
    res.status(400).json({ error: "lat and lon query params are required" });
    return;
  }

  try {
    const data = await searchYelpBusinesses({
      lat: parseFloat(lat),
      lon: parseFloat(lon),
      term: typeof term === "string" ? term : undefined,
    });
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Yelp search failed" });
  }
}
