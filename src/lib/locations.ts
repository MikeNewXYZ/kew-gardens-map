import MiniSearch from "minisearch";

/** A non-plant point of interest inside the gardens (from OpenStreetMap). */
export interface LocationProps {
  name: string;
  category: LocationCategory;
  kind: string;
  detail: string;
  image?: string;
  website?: string;
}

export type LocationCategory =
  | "glasshouse"
  | "attraction"
  | "garden"
  | "gallery"
  | "gate"
  | "food"
  | "facility";

export type LocationCollection = GeoJSON.FeatureCollection<GeoJSON.Point, LocationProps>;

export interface LocationResult {
  name: string;
  category: LocationCategory;
  kind: string;
  detail: string;
  image: string;
  lng: number;
  lat: number;
  score: number;
}

/** Display metadata per category — drives section order, labels and colour. */
export const CATEGORY_META: Record<
  LocationCategory,
  { label: string; plural: string; color: string; order: number }
> = {
  glasshouse: { label: "Glasshouse", plural: "Glasshouses", color: "#2d6a4f", order: 0 },
  attraction: { label: "Attraction", plural: "Attractions", color: "#9c4a32", order: 1 },
  garden: { label: "Garden", plural: "Gardens & collections", color: "#40916c", order: 2 },
  gallery: { label: "Gallery", plural: "Galleries & palaces", color: "#7d5ba6", order: 3 },
  food: { label: "Food & drink", plural: "Food & drink", color: "#b8862f", order: 4 },
  gate: { label: "Entrance", plural: "Entrances", color: "#5d6b62", order: 5 },
  facility: { label: "Facility", plural: "Facilities", color: "#6b7280", order: 6 },
};

export const CATEGORY_ORDER = (Object.keys(CATEGORY_META) as LocationCategory[]).sort(
  (a, b) => CATEGORY_META[a].order - CATEGORY_META[b].order,
);

let cache: Promise<LocationCollection> | null = null;

/** Load the Kew locations GeoJSON once and reuse it across views. */
export function loadLocations(): Promise<LocationCollection> {
  if (!cache) {
    cache = fetch("/kew-locations.geojson").then((r) => {
      if (!r.ok) throw new Error(`Failed to load locations: ${r.status}`);
      return r.json() as Promise<LocationCollection>;
    });
  }
  return cache;
}

interface LocationDoc {
  id: number;
  name: string;
  category: LocationCategory;
  kind: string;
  detail: string;
  image: string;
  lng: number;
  lat: number;
}

const SEARCH_OPTIONS = {
  prefix: true,
  fuzzy: 0.2,
  boost: { name: 4, detail: 1, category: 1 },
  combineWith: "AND" as const,
};

/** Build a MiniSearch index from location features. Pure — easy to unit-test. */
export function createLocationIndex(
  features: LocationCollection["features"],
): MiniSearch<LocationDoc> {
  const mini = new MiniSearch<LocationDoc>({
    fields: ["name", "detail", "category", "kind"],
    storeFields: ["name", "category", "kind", "detail", "image", "lng", "lat"],
    searchOptions: SEARCH_OPTIONS,
  });
  mini.addAll(
    features.map((f, id): LocationDoc => ({
      id,
      name: f.properties.name,
      category: f.properties.category,
      kind: f.properties.kind,
      detail: f.properties.detail,
      image: f.properties.image ?? "",
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
    })),
  );
  return mini;
}

/** All locations as results, sorted by name — used for the default browse view. */
export async function listLocations(): Promise<LocationResult[]> {
  const d = await loadLocations();
  return d.features
    .map((f): LocationResult => ({
      name: f.properties.name,
      category: f.properties.category,
      kind: f.properties.kind,
      detail: f.properties.detail,
      image: f.properties.image ?? "",
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      score: 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

let indexPromise: Promise<MiniSearch<LocationDoc>> | null = null;

function getIndex(): Promise<MiniSearch<LocationDoc>> {
  if (!indexPromise) {
    indexPromise = loadLocations().then((d) => createLocationIndex(d.features));
  }
  return indexPromise;
}

/** Search locations; returns scored results (already unique by name). */
export async function searchLocations(query: string, limit = 20): Promise<LocationResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const mini = await getIndex();
  return mini.search(q).slice(0, limit).map((r) => ({
    name: r.name as string,
    category: r.category as LocationCategory,
    kind: r.kind as string,
    detail: r.detail as string,
    image: (r.image as string) ?? "",
    lng: r.lng as number,
    lat: r.lat as number,
    score: r.score,
  }));
}
