// Scrapes plant records from Kew's "Garden Explorer" map and writes a GeoJSON.
//
// The map (map.aspx) exposes two ASP.NET PageMethods:
//   POST /map.aspx/GetFeatures      -> GeoJSON FeatureCollection of every marker
//                                       in a lon/lat bbox (no names, just ids)
//   POST /map.aspx/GetFeatureText   -> "<span>Species name</span>|AccessionNo"
//                                       for a single feature id (fid)
//
// So we fetch all features once, then resolve each plant feature's name with a
// polite, resumable, concurrency-capped pass. Re-running resumes from the cache.

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://kew.gardenexplorer.org/map.aspx";
// Bounding box covering the whole of Kew Gardens: minLon,minLat,maxLon,maxLat
const BBOX = "-0.310,51.465,-0.275,51.495";

const CONCURRENCY = 6;          // simultaneous in-flight detail requests
const REQUEST_DELAY_MS = 40;    // gap between detail requests (politeness)
const MAX_RETRIES = 4;
const CHECKPOINT_EVERY = 200;   // flush cache to disk this often

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = join(ROOT, "scripts", "cache");
const FEATURES_CACHE = join(CACHE_DIR, "features.json");   // raw GetFeatures
const TEXT_CACHE = join(CACHE_DIR, "text.json");           // fid -> raw text
const OUT = join(ROOT, "public", "kew-plants.geojson");

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "X-Requested-With": "XMLHttpRequest",
  "User-Agent": "kew-gardens-map/0.1 (personal mapping project)",
  Origin: "https://kew.gardenexplorer.org",
  Referer: BASE,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(method, body, attempt = 1) {
  try {
    const res = await fetch(`${BASE}/${method}`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.d; // ASP.NET wraps payloads in { d: ... }
  } catch (err) {
    if (attempt >= MAX_RETRIES) throw err;
    await sleep(250 * attempt * attempt); // backoff
    return post(method, body, attempt + 1);
  }
}

async function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

// "<span dir="ltr">Juniperus chinensis</span>|2019-2886*1" -> {name, accession}
function parseText(raw) {
  if (!raw) return { name: "", accession: "" };
  const stripped = raw.replace(/<[^>]*>/g, "").trim();
  const i = stripped.indexOf("|");
  if (i === -1) return { name: stripped, accession: "" };
  return {
    name: stripped.slice(0, i).trim(),
    accession: stripped.slice(i + 1).trim(),
  };
}

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });
  await mkdir(dirname(OUT), { recursive: true });

  // 1. Fetch (or reuse) the full feature collection.
  let collection = await loadJson(FEATURES_CACHE, null);
  if (!collection) {
    console.log("Fetching GetFeatures over bbox", BBOX, "...");
    collection = await post("GetFeatures", {
      currzoom: 18, prevzoom: 18, startzoom: 14,
      usecluster: false, isloaded: false, bounds: BBOX,
    });
    await writeFile(FEATURES_CACHE, JSON.stringify(collection));
  }
  const all = collection.features ?? [];
  // icon "1" == an accessioned plant (has a resolvable name); "0" == decoration
  const plants = all.filter((f) => f.properties?.icon === "1");
  console.log(`Features: ${all.length} total, ${plants.length} plant records.`);

  // 2. Resolve names for each plant fid (resumable via TEXT_CACHE).
  const textCache = await loadJson(TEXT_CACHE, {});
  const todo = plants.filter((f) => !(f.id in textCache));
  console.log(`Need names for ${todo.length} (${plants.length - todo.length} cached).`);

  let done = 0;
  let sinceCheckpoint = 0;
  const flush = async () => {
    await writeFile(TEXT_CACHE, JSON.stringify(textCache));
    sinceCheckpoint = 0;
  };

  // Simple worker pool over a shared cursor.
  let cursor = 0;
  async function worker() {
    while (cursor < todo.length) {
      const f = todo[cursor++];
      try {
        textCache[f.id] = await post("GetFeatureText", { fid: f.id });
      } catch (err) {
        textCache[f.id] = ""; // record the miss so we don't spin on it forever
        console.warn(`  miss ${f.id}: ${err.message}`);
      }
      done++;
      if (++sinceCheckpoint >= CHECKPOINT_EVERY) {
        await flush();
        console.log(`  ${done}/${todo.length} resolved...`);
      }
      await sleep(REQUEST_DELAY_MS);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await flush();

  // 3. Build the enriched GeoJSON.
  const features = plants.map((f) => {
    const { name, accession } = parseText(textCache[f.id]);
    // Genus = first token of the botanical name (used for data-driven colouring).
    const genus = name.split(/\s+/)[0] ?? "";
    return {
      type: "Feature",
      id: f.id,
      geometry: f.geometry,
      properties: { name, genus, accession, fid: f.id },
    };
  }).filter((f) => f.properties.name); // drop any that never resolved

  await writeFile(OUT, JSON.stringify({ type: "FeatureCollection", features }));
  console.log(`\nWrote ${features.length} plant features -> ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
