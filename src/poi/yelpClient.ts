import type { YelpBusiness } from "../types";

interface RawYelpBusiness {
  id: string;
  name: string;
  rating: number;
  review_count: number;
  price?: string;
  categories: { title: string }[];
  image_url?: string;
  business_hours?: { is_open_now: boolean }[];
  location: { display_address: string[] };
  display_phone?: string;
  url: string;
  coordinates?: { latitude: number; longitude: number };
  distance?: number;
}

/** Calls our own /api/yelp-search proxy (never Yelp directly — see api/_yelpProxy.ts for why). */
export async function searchNearby(lat: number, lon: number, term?: string): Promise<YelpBusiness[]> {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  if (term) params.set("term", term);

  const response = await fetch(`/api/yelp-search?${params}`);
  if (!response.ok) {
    throw new Error(`Yelp search failed: ${response.status}`);
  }
  const body = (await response.json()) as { businesses: RawYelpBusiness[] };
  return body.businesses.map((b) => ({
    id: b.id,
    name: b.name,
    rating: b.rating,
    reviewCount: b.review_count,
    price: b.price ?? null,
    categories: b.categories.map((c) => c.title),
    imageUrl: b.image_url ?? null,
    isOpenNow: b.business_hours?.[0]?.is_open_now ?? null,
    address: b.location.display_address.join(", "),
    phone: b.display_phone ?? null,
    yelpUrl: b.url,
    coordinates: b.coordinates ? { lat: b.coordinates.latitude, lon: b.coordinates.longitude } : null,
    distance: b.distance ?? null,
  }));
}

// Yelp's best_match cheerfully returns a nearby-but-unrelated business when the searched place
// isn't on Yelp (a bank branch, an office). Showing that is worse than showing nothing, so accept
// a result only when its name actually overlaps the searched name.
const STOP_WORDS = new Set(["the", "a", "an", "of", "and", "&", "inc", "llc", "co", "company"]);
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t && !STOP_WORDS.has(t));
}

/** Picks the Yelp result that best matches the searched place by name, or null if none is a plausible match. */
export function matchBusiness(businesses: YelpBusiness[], name: string): YelpBusiness | null {
  const wanted = tokenize(name);
  if (wanted.length === 0) return businesses[0] ?? null;
  let best: YelpBusiness | null = null;
  let bestScore = 0;
  for (const b of businesses) {
    const have = new Set(tokenize(b.name));
    // Fraction of the searched name's words that appear in the business name. Require at least
    // half so "BNP" never matches "Wells Fargo", but "BNP Paribas" still matches "BNP Paribas USA".
    const overlap = wanted.filter((t) => have.has(t)).length / wanted.length;
    if (overlap >= 0.5 && overlap > bestScore) {
      best = b;
      bestScore = overlap;
    }
  }
  return best;
}
