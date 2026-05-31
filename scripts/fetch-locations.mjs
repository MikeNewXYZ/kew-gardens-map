// Fetches named non-plant locations inside Kew Gardens from OpenStreetMap
// (Overpass API), clips them to the garden boundary, categorises each, and
// writes public/kew-locations.geojson.
//
//   node scripts/fetch-locations.mjs
//
// Categories: glasshouse, attraction, gallery, garden, food, facility, gate.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BOUNDARY = join(ROOT, "public", "kew-boundary.geojson");
const OUT = join(ROOT, "public", "kew-locations.geojson");

const OVERPASS = "https://overpass-api.de/api/interpreter";
// S,W,N,E from the boundary, padded slightly.
const BBOX = "51.4700,-0.3110,51.4866,-0.2862";

const QUERY = `
[out:json][timeout:90];
(
  nwr["tourism"]["name"](${BBOX});
  nwr["historic"]["name"](${BBOX});
  nwr["leisure"~"garden|park|playground|nature_reserve|bird_hide|bandstand"]["name"](${BBOX});
  nwr["amenity"~"cafe|restaurant|fast_food|bar|ice_cream|toilets|drinking_water|shelter|arts_centre|theatre|place_of_worship"]["name"](${BBOX});
  nwr["shop"]["name"](${BBOX});
  nwr["building"~"greenhouse|conservatory|temple|palace|chapel|cathedral|cabin"]["name"](${BBOX});
  nwr["man_made"~"tower|bridge|obelisk|water_well"]["name"](${BBOX});
  nwr["barrier"="gate"]["name"](${BBOX});
  nwr["historic"="monument"](${BBOX});
);
out center tags;
`;

// ---- point-in-polygon (ray casting) against the boundary ring ---------------
function buildContains(geometry) {
  const rings = geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
  return ([x, y]) => {
    let inside = false;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    return inside;
  };
}

// Strip audio-tour "Stop N - " prefixes and ", Kew Gardens" suffixes.
function normaliseName(raw) {
  return raw
    .replace(/^stop\s*\d+\s*[-–—:]\s*/i, "")
    .replace(/,?\s*kew\s*gardens?$/i, "")
    .trim();
}

// ---- categorisation (priority order matters) --------------------------------
const GLASSHOUSE_NAMES = /(house|conservatory|orangery|stove)$|conservatory|nash/i;
const NOT_GLASSHOUSE = /nursery|cage|restaurant|fountain|tea\s?house|gate\s?house/i;

function categorise(tags, name) {
  const t = tags;
  const n = name.toLowerCase();

  // The whole-site relation / generic park polygon is not a "place".
  if (/^royal botanic gardens/.test(n)) return null;

  // Interpretive sign-boards & guideposts are noise, not places.
  if (t.tourism === "information" && t.information !== "office" && t.information !== "visitor_centre") {
    return null;
  }

  // 1. Food & drink (by amenity tag — checked before name heuristics).
  if (["cafe", "restaurant", "fast_food", "bar", "ice_cream"].includes(t.amenity)) {
    return { category: "food", kind: t.amenity };
  }
  // 2. Practical facilities.
  if (t.amenity === "toilets" || t.amenity === "drinking_water" || t.shop || t.leisure === "playground") {
    return { category: "facility", kind: t.shop ? "shop" : t.amenity || t.leisure };
  }
  // 3. Entrances / gates.
  if (t.barrier === "gate" || /\bgate\b/.test(n)) {
    return { category: "gate", kind: "gate" };
  }
  // 4. Galleries, museums, palaces.
  if (t.tourism === "gallery" || t.tourism === "museum" || /\b(gallery|museum)\b/.test(n) || /^kew palace$/.test(n)) {
    return { category: "gallery", kind: t.tourism ?? (/palace/.test(n) ? "palace" : "gallery") };
  }
  // 5. Glasshouses & conservatories.
  if (
    ((t.building === "greenhouse" || t.building === "conservatory" || GLASSHOUSE_NAMES.test(n)) &&
      !NOT_GLASSHOUSE.test(n))
  ) {
    return { category: "glasshouse", kind: "glasshouse" };
  }
  // 6. Attractions, monuments, landmarks, bridges, towers, sculptures.
  if (
    t.tourism === "attraction" ||
    t.tourism === "artwork" ||
    t.tourism === "viewpoint" ||
    t.historic ||
    t.man_made === "tower" ||
    t.man_made === "bridge" ||
    t.man_made === "obelisk" ||
    t.building === "temple" ||
    /pagoda|temple|hive|walkway|gateway|arch|crossing|minka|obelisk|column|folly|cottage/.test(n)
  ) {
    return { category: "attraction", kind: t.historic || t.tourism || t.man_made || "landmark" };
  }
  // 7. Gardens, arboreta, collections.
  if (t.leisure === "garden" || t.leisure === "park" || /garden|arboretum|collection|grove|dell|glade|beds$/.test(n)) {
    return { category: "garden", kind: t.leisure ?? "garden" };
  }
  return null; // uncategorised → dropped
}

// A short human label from tags for the card subtitle.
function describe(tags, kind) {
  const map = {
    cafe: "Café", restaurant: "Restaurant", fast_food: "Quick bites", bar: "Bar",
    ice_cream: "Ice cream", toilets: "Toilets", drinking_water: "Drinking water",
    shop: "Shop", information: "Visitor information", playground: "Playground",
    gallery: "Gallery", museum: "Museum", palace: "Historic palace",
    glasshouse: "Glasshouse", gate: "Entrance", garden: "Garden",
    bridge: "Bridge", tower: "Tower", monument: "Monument", memorial: "Memorial",
    artwork: "Artwork", attraction: "Attraction", landmark: "Landmark",
  };
  return map[kind] ?? (kind ? kind.replace(/_/g, " ") : "");
}

const UA = "kew-gardens-map/0.1 (personal mapping project)";
const commonsThumb = (file) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/^File:/i, ""))}?width=480`;

async function getJson(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

// Resolve a thumbnail URL for each feature, in order of preference:
// image tag -> wikimedia_commons -> Wikidata P18 -> Wikipedia pageimage.
async function resolveImages(features) {
  // Wikidata P18 (batched, 45 ids/call).
  const qids = [...new Set(features.map((f) => f._wikidata).filter(Boolean))];
  const qImage = {};
  for (let i = 0; i < qids.length; i += 45) {
    const batch = qids.slice(i, i + 45).join("|");
    try {
      const j = await getJson(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${batch}&props=claims&format=json&origin=*`,
      );
      for (const [qid, ent] of Object.entries(j.entities ?? {})) {
        const p18 = ent.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
        if (p18) qImage[qid] = p18;
      }
    } catch (e) {
      console.warn("  wikidata batch failed:", e.message);
    }
  }

  const validCommons = (c) => c && /^File:/i.test(c);

  // Wikipedia pageimages for whatever is still uncovered (grouped by language).
  const byLang = {};
  for (const f of features) {
    if (f._image || validCommons(f._commons) || (f._wikidata && qImage[f._wikidata])) continue;
    const m = /^([a-z]{2,3}):(.+)$/.exec(f._wikipedia || "");
    if (m) (byLang[m[1]] ??= new Map()).set(m[2], f);
  }
  for (const [lang, map] of Object.entries(byLang)) {
    const titles = [...map.keys()];
    for (let i = 0; i < titles.length; i += 40) {
      const batch = titles.slice(i, i + 40).map(encodeURIComponent).join("|");
      try {
        const j = await getJson(
          `https://${lang}.wikipedia.org/w/api.php?action=query&prop=pageimages&piprop=thumbnail&pithumbsize=480&format=json&origin=*&titles=${batch}`,
        );
        for (const page of Object.values(j.query?.pages ?? {})) {
          const f = map.get(page.title);
          if (f && page.thumbnail?.source) f.properties.image = page.thumbnail.source;
        }
      } catch (e) {
        console.warn(`  wikipedia(${lang}) batch failed:`, e.message);
      }
    }
  }

  // Apply preference order; strip the scratch fields.
  for (const f of features) {
    if (!f.properties.image) {
      if (f._image && /^https?:\/\//.test(f._image)) f.properties.image = f._image;
      else if (validCommons(f._commons)) f.properties.image = commonsThumb(f._commons);
      else if (f._wikidata && qImage[f._wikidata]) f.properties.image = commonsThumb(qImage[f._wikidata]);
    }
    delete f._wikidata;
    delete f._commons;
    delete f._image;
    delete f._wikipedia;
  }
}

async function main() {
  const boundary = JSON.parse(await readFile(BOUNDARY, "utf8"));
  const geom = (boundary.features?.[0] ?? boundary).geometry;
  const contains = buildContains(geom);

  console.log("Querying Overpass…");
  const res = await fetch(OVERPASS, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "kew-gardens-map/0.1 (personal mapping project)",
      Accept: "application/json",
    },
    body: "data=" + encodeURIComponent(QUERY),
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  const { elements } = await res.json();
  console.log(`Overpass returned ${elements.length} elements.`);

  // Collect all candidates, then de-dupe by name across categories, preferring
  // the more specific category (a gate tagged with a bin shouldn't be a "facility").
  const PRIORITY = { food: 0, gallery: 1, glasshouse: 2, gate: 3, attraction: 4, garden: 5, facility: 6 };
  const candidates = [];
  for (const el of elements) {
    const lon = el.lon ?? el.center?.lon;
    const lat = el.lat ?? el.center?.lat;
    const name = el.tags?.name ? normaliseName(el.tags.name) : "";
    if (lon == null || lat == null || !name) continue;
    if (!contains([lon, lat])) continue; // outside the gardens

    const cat = categorise(el.tags, name);
    if (!cat) continue;

    candidates.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [Number(lon.toFixed(6)), Number(lat.toFixed(6))] },
      properties: {
        name,
        category: cat.category,
        kind: cat.kind,
        detail: describe(el.tags, cat.kind),
        image: "",
        website: el.tags.website ?? el.tags["contact:website"] ?? "",
      },
      // Raw image references, resolved below then stripped.
      _wikidata: el.tags.wikidata ?? "",
      _commons: el.tags.wikimedia_commons ?? "",
      _image: el.tags.image ?? "",
      _wikipedia: el.tags.wikipedia ?? "",
    });
  }

  candidates.sort((a, b) => PRIORITY[a.properties.category] - PRIORITY[b.properties.category]);
  const seen = new Set();
  const features = [];
  for (const f of candidates) {
    const key = f.properties.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    features.push(f);
  }
  features.sort((a, b) => a.properties.name.localeCompare(b.properties.name));

  console.log("Resolving images…");
  await resolveImages(features);

  const counts = {};
  for (const f of features) counts[f.properties.category] = (counts[f.properties.category] ?? 0) + 1;
  const withImg = features.filter((f) => f.properties.image).length;

  await writeFile(OUT, JSON.stringify({ type: "FeatureCollection", features }, null, 0));
  console.log(`Wrote ${features.length} locations (${withImg} with images) -> ${OUT}`);
  console.log("By category:", counts);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
