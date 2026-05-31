import MiniSearch from "minisearch";
import { loadPlants, type PlantCollection } from "./plants.ts";

/** One indexed specimen document. */
export interface PlantDoc {
  id: number;
  name: string;
  genus: string;
  accession: string;
  lng: number;
  lat: number;
}

/** A single specimen location within a species group. */
export interface Specimen {
  accession: string;
  lng: number;
  lat: number;
}

/** Search results are grouped by species name (many specimens share a name). */
export interface SpeciesResult {
  name: string;
  genus: string;
  count: number;
  specimens: Specimen[];
  score: number;
}

const SEARCH_OPTIONS = {
  prefix: true, // "gink" -> "Ginkgo"
  fuzzy: 0.2, // ~1 typo per 5 chars: "ginko" -> "Ginkgo"
  boost: { name: 3, genus: 2, accession: 1 },
  combineWith: "AND" as const,
};

/** First whitespace-delimited token of a scientific name is its genus. */
function genusOf(name: string, fallback?: string): string {
  return fallback?.trim() || name.split(" ")[0] || name;
}

/** Build a MiniSearch index from plant features. Pure — easy to unit-test. */
export function createPlantIndex(
  features: PlantCollection["features"],
): MiniSearch<PlantDoc> {
  const mini = new MiniSearch<PlantDoc>({
    fields: ["name", "genus", "accession"],
    storeFields: ["name", "genus", "accession", "lng", "lat"],
    searchOptions: SEARCH_OPTIONS,
  });

  const docs: PlantDoc[] = features.map((f, i): PlantDoc => ({
    id: i,
    name: f.properties.name,
    genus: genusOf(f.properties.name, f.properties.genus),
    accession: f.properties.accession,
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }));
  mini.addAll(docs);
  return mini;
}

/** A raw MiniSearch hit (stored fields are flattened onto the result). */
export interface RawHit {
  score: number;
  name: string;
  genus: string;
  accession: string;
  lng: number;
  lat: number;
  [key: string]: unknown;
}

/** Collapse raw specimen hits into ranked species groups. Pure. */
export function groupResults(raw: RawHit[], limit = 40): SpeciesResult[] {
  const groups = new Map<string, SpeciesResult>();
  for (const r of raw) {
    const name = r.name as string;
    let g = groups.get(name);
    if (!g) {
      g = { name, genus: r.genus as string, count: 0, specimens: [], score: r.score };
      groups.set(name, g);
    }
    g.count += 1;
    if (g.specimens.length < 200) {
      g.specimens.push({ accession: r.accession as string, lng: r.lng as number, lat: r.lat as number });
    }
    g.score = Math.max(g.score, r.score);
  }
  return [...groups.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Run a query against an index and return grouped species results. Pure. */
export function searchIndex(
  mini: MiniSearch<PlantDoc>,
  query: string,
  limit = 40,
): SpeciesResult[] {
  const q = query.trim();
  if (q.length < 2) return [];
  return groupResults(mini.search(q) as unknown as RawHit[], limit);
}

// ---- Lazy singleton wired to the live dataset -------------------------------

let indexPromise: Promise<MiniSearch<PlantDoc>> | null = null;

export function getSearchIndex(): Promise<MiniSearch<PlantDoc>> {
  if (!indexPromise) {
    indexPromise = loadPlants().then((data) => createPlantIndex(data.features));
  }
  return indexPromise;
}

export async function searchPlants(query: string, limit = 40): Promise<SpeciesResult[]> {
  if (query.trim().length < 2) return [];
  const mini = await getSearchIndex();
  return searchIndex(mini, query, limit);
}

/** "Did you mean…" term suggestions when a query has few/no hits. */
export async function suggestTerms(query: string, limit = 5): Promise<string[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const mini = await getSearchIndex();
  return mini
    .autoSuggest(q, { fuzzy: 0.3, prefix: true })
    .slice(0, limit)
    .map((s) => s.suggestion);
}
