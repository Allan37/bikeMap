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
  }));
}
