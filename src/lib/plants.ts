export interface PlantProps {
  name: string;
  genus: string;
  accession: string;
  fid: string;
}

export type PlantCollection = GeoJSON.FeatureCollection<GeoJSON.Point, PlantProps>;

/** Genus colour palette + the `match` expression used for data-driven styling. */
export interface GenusStyle {
  /** Top genera with their assigned colour, for legend + paint. */
  legend: { genus: string; color: string; count: number }[];
  /** Mapbox `match` expression: genus -> colour, with a grey fallback. */
  colorExpression: (string | string[])[];
  otherColor: string;
}

// Colourblind-safe qualitative palette (ColorBrewer / Okabe-Ito blend).
const PALETTE = [
  "#117733", "#332288", "#88ccee", "#ddcc77", "#cc6677", "#aa4499",
  "#44aa99", "#999933", "#882255", "#6699cc", "#e69f00", "#d55e00",
];
const OTHER_COLOR = "#9aa7b0";

/** Build a categorical colour scheme from the N most common genera. */
export function buildGenusStyle(data: PlantCollection, topN = PALETTE.length): GenusStyle {
  const counts = new Map<string, number>();
  for (const f of data.features) {
    const g = f.properties.genus;
    if (g) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);

  const legend = top.map(([genus, count], i) => ({ genus, color: PALETTE[i], count }));

  // ["match", ["get","genus"], g1, c1, g2, c2, ..., OTHER_COLOR]
  const colorExpression: (string | string[])[] = ["match", ["get", "genus"]];
  for (const { genus, color } of legend) colorExpression.push(genus, color);
  colorExpression.push(OTHER_COLOR);

  return { legend, colorExpression, otherColor: OTHER_COLOR };
}

let cache: Promise<PlantCollection> | null = null;

/** Load the Kew plant accessions GeoJSON once and reuse it across views. */
export function loadPlants(): Promise<PlantCollection> {
  if (!cache) {
    cache = fetch("/kew-plants.geojson").then((r) => {
      if (!r.ok) throw new Error(`Failed to load plants: ${r.status}`);
      return r.json() as Promise<PlantCollection>;
    });
  }
  return cache;
}
