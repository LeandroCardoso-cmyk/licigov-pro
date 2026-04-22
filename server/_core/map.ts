/**
 * Google Maps integration — Forge proxy removed.
 * To re-enable: use the Google Maps JavaScript/Node.js client with your own API key
 * (set GOOGLE_MAPS_API_KEY in .env and call maps.googleapis.com directly).
 */

export type TravelMode = "driving" | "walking" | "bicycling" | "transit";
export type MapType = "roadmap" | "satellite" | "terrain" | "hybrid";
export type SpeedUnit = "KPH" | "MPH";

export type LatLng = { lat: number; lng: number };

export type GeocodingResult = {
  results: Array<{
    address_components: Array<{ long_name: string; short_name: string; types: string[] }>;
    formatted_address: string;
    geometry: { location: LatLng; location_type: string; viewport: { northeast: LatLng; southwest: LatLng } };
    place_id: string;
    types: string[];
  }>;
  status: string;
};

export type DirectionsResult = {
  routes: Array<{
    legs: Array<{
      distance: { text: string; value: number };
      duration: { text: string; value: number };
      start_address: string;
      end_address: string;
      start_location: LatLng;
      end_location: LatLng;
      steps: Array<{
        distance: { text: string; value: number };
        duration: { text: string; value: number };
        html_instructions: string;
        travel_mode: string;
        start_location: LatLng;
        end_location: LatLng;
      }>;
    }>;
    overview_polyline: { points: string };
    summary: string;
    warnings: string[];
    waypoint_order: number[];
  }>;
  status: string;
};

export type DistanceMatrixResult = {
  rows: Array<{ elements: Array<{ distance: { text: string; value: number }; duration: { text: string; value: number }; status: string }> }>;
  origin_addresses: string[];
  destination_addresses: string[];
  status: string;
};

export type PlacesSearchResult = {
  results: Array<{
    place_id: string;
    name: string;
    formatted_address: string;
    geometry: { location: LatLng };
    rating?: number;
    user_ratings_total?: number;
    business_status?: string;
    types: string[];
  }>;
  status: string;
};

export type PlaceDetailsResult = {
  result: {
    place_id: string;
    name: string;
    formatted_address: string;
    formatted_phone_number?: string;
    international_phone_number?: string;
    website?: string;
    rating?: number;
    user_ratings_total?: number;
    reviews?: Array<{ author_name: string; rating: number; text: string; time: number }>;
    opening_hours?: { open_now: boolean; weekday_text: string[] };
    geometry: { location: LatLng };
  };
  status: string;
};

export type ElevationResult = {
  results: Array<{ elevation: number; location: LatLng; resolution: number }>;
  status: string;
};

export type TimeZoneResult = {
  dstOffset: number;
  rawOffset: number;
  status: string;
  timeZoneId: string;
  timeZoneName: string;
};

export type RoadsResult = {
  snappedPoints: Array<{ location: LatLng; originalIndex?: number; placeId: string }>;
};

export async function makeRequest<T = unknown>(
  endpoint: string,
  _params: Record<string, unknown> = {},
  _options: { method?: "GET" | "POST"; body?: Record<string, unknown> } = {}
): Promise<T> {
  throw new Error(
    `Maps API endpoint "${endpoint}" is not available. The Forge proxy has been removed. Configure GOOGLE_MAPS_API_KEY and call maps.googleapis.com directly.`
  );
}
