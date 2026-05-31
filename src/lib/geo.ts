export type LngLat = [number, number];

/** Great-circle distance in metres between two [lng, lat] points. */
export function haversineMeters(a: LngLat, b: LngLat): number {
  const R = 6_371_000;
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

/** The item whose coordinate is closest to `from`, or null if empty. */
export function nearest<T>(
  from: LngLat,
  items: readonly T[],
  coordsOf: (t: T) => LngLat,
): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const it of items) {
    const d = haversineMeters(from, coordsOf(it));
    if (d < bestD) {
      bestD = d;
      best = it;
    }
  }
  return best;
}

/** Resolve the visitor's position, or null if unavailable/denied (never rejects). */
export function getCurrentPosition(timeout = 8000): Promise<LngLat | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve([p.coords.longitude, p.coords.latitude]),
      () => resolve(null),
      { enableHighAccuracy: true, timeout, maximumAge: 30_000 },
    );
  });
}
