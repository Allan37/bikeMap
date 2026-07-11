export interface Coordinates {
  lat: number;
  lon: number;
}

/** Static info about a Citibike station — rarely changes, from GBFS station_information.json */
export interface StationInfo {
  stationId: string;
  name: string;
  lat: number;
  lon: number;
  capacity: number;
}

/** Live availability for a Citibike station — from GBFS station_status.json, refreshed on a poll interval */
export interface StationStatus {
  stationId: string;
  bikesAvailable: number;
  /** Subset of bikesAvailable that are e-bikes; the rest are classic/standard bikes. */
  ebikesAvailable: number;
  docksAvailable: number;
  isRenting: boolean;
  isReturning: boolean;
}

/** A station with its static info and latest live status merged together */
export interface Station extends StationInfo {
  status: StationStatus | null;
}

/** A selected search result — a place the user picked as their destination. */
export interface POI {
  name: string;
  placeFormatted: string;
  lat: number;
  lon: number;
}

export interface RouteLeg {
  mode: "walk" | "bike";
  durationSeconds: number;
  distanceMeters: number;
  /** Null only for an estimated bike leg that hasn't been refined with a real Directions call yet. */
  geometry: GeoJSON.LineString | null;
  /** True for a straight-line-distance estimate rather than a real routed Directions API result. */
  estimated: boolean;
}

/** One ranked way to get from A to B: walk to a station, bike, walk the rest. */
export interface RouteOption {
  originStation: Station;
  destinationStation: Station;
  walkToStation: RouteLeg;
  bikeLeg: RouteLeg;
  walkFromStation: RouteLeg;
  totalDurationSeconds: number;
}

/** A Yelp business match for a selected destination, for the Apple-Maps-style POI card. */
export interface YelpBusiness {
  id: string;
  name: string;
  rating: number;
  reviewCount: number;
  price: string | null;
  categories: string[];
  imageUrl: string | null;
  isOpenNow: boolean | null;
  address: string;
  phone: string | null;
  yelpUrl: string;
  /** Business location, when Yelp provides it — used for the "Open in Apple Maps" pin. */
  coordinates: Coordinates | null;
  /** Meters from the searched point, per Yelp — used to break ties when matching. */
  distance: number | null;
}
