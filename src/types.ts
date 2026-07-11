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
