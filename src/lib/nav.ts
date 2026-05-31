import mapboxgl from "mapbox-gl";
import type { PlantCollection } from "./plants.ts";

export type LngLat = [number, number];

/** Straight-line distance in metres (haversine). */
export function haversine(a: LngLat, b: LngLat): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface NearestHit {
  name: string;
  accession: string;
  coords: LngLat;
  metres: number;
}

/**
 * Nearest specimen matching `name` (as the crow flies). Geometric narrowing is
 * appropriate here — we route the single winner with the Directions API.
 */
export function nearestNamed(
  from: LngLat,
  data: PlantCollection,
  name: string,
): NearestHit | null {
  const target = name.trim().toLowerCase();
  let best: NearestHit | null = null;
  for (const f of data.features) {
    if (f.properties.name.toLowerCase() !== target) continue;
    const coords = f.geometry.coordinates as LngLat;
    const metres = haversine(from, coords);
    if (!best || metres < best.metres) {
      best = { name: f.properties.name, accession: f.properties.accession, coords, metres };
    }
  }
  return best;
}

/**
 * Resolve the visitor's current location via the device GPS. Returns null if
 * geolocation is unavailable or permission is denied — callers should surface
 * that rather than routing from a made-up point.
 */
export function resolveStart(): Promise<LngLat | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve([p.coords.longitude, p.coords.latitude]),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
    );
  });
}

export interface WalkingRoute {
  geometry: GeoJSON.LineString;
  metres: number;
  seconds: number;
}

/** Walking route between two points via the Mapbox Directions API. */
export async function fetchWalkingRoute(from: LngLat, to: LngLat): Promise<WalkingRoute | null> {
  const coords = `${from[0]},${from[1]};${to[0]},${to[1]}`;
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/walking/${coords}` +
    `?geometries=geojson&overview=full&access_token=${mapboxgl.accessToken}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = (await res.json()) as {
    routes?: Array<{ geometry: GeoJSON.LineString; distance: number; duration: number }>;
  };
  const route = json.routes?.[0];
  if (!route) return null;
  return { geometry: route.geometry, metres: route.distance, seconds: route.duration };
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

export function formatDuration(s: number): string {
  const min = Math.round(s / 60);
  return min < 1 ? "<1 min" : `${min} min`;
}
