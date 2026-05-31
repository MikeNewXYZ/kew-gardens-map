import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { highlightMatch } from "../lib/highlight.tsx";
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  listLocations,
  searchLocations,
  type LocationResult,
} from "../lib/locations.ts";
import { searchPlants, suggestTerms, type SpeciesResult } from "../lib/search.ts";
import { useDebounced } from "../lib/useDebounced.ts";
import styles from "./SearchView.module.css";

type Item =
  | { type: "location"; loc: LocationResult }
  | { type: "plant"; plant: SpeciesResult };

interface Section {
  key: string;
  heading: string;
  color: string;
  kind: "location" | "plant";
  items: Item[];
}

/** Crisp arrow for "Navigate" buttons (renders identically on every device). */
function NavArrow() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 12h15" />
      <path d="m13 5 7 7-7 7" />
    </svg>
  );
}

export function SearchView() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [plants, setPlants] = useState<SpeciesResult[]>([]);
  const [locations, setLocations] = useState<LocationResult[]>([]);
  const [browse, setBrowse] = useState<LocationResult[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const debounced = useDebounced(query, 160);
  const hasQuery = debounced.trim().length >= 2;

  // Load every location once so the gardens browse by default (no query needed).
  useEffect(() => {
    listLocations().then(setBrowse).catch((e) => console.error(e));
  }, []);

  // Run plant + location search whenever the debounced query changes (race-safe).
  useEffect(() => {
    let cancelled = false;
    if (!hasQuery) {
      setPlants([]);
      setLocations([]);
      setSuggestions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([searchPlants(debounced), searchLocations(debounced)])
      .then(async ([p, l]) => {
        if (cancelled) return;
        setPlants(p);
        setLocations(l);
        setActive(0);
        setSuggestions(p.length === 0 && l.length === 0 ? await suggestTerms(debounced) : []);
      })
      .catch((e) => console.error(e))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [debounced, hasQuery]);

  // With a query: searched results. Without: browse every location by category.
  const locResults = hasQuery ? locations : browse;
  const plantResults = hasQuery ? plants : [];

  // Build category sections (locations first, by category order; plants last).
  const sections: Section[] = [];
  for (const cat of CATEGORY_ORDER) {
    const items = locResults.filter((l) => l.category === cat);
    if (items.length) {
      sections.push({
        key: cat,
        heading: CATEGORY_META[cat].plural,
        color: CATEGORY_META[cat].color,
        kind: "location",
        items: items.map((loc) => ({ type: "location", loc })),
      });
    }
  }
  if (plantResults.length) {
    sections.push({
      key: "plants",
      heading: "Plants",
      color: "#1b4332",
      kind: "plant",
      items: plantResults.map((plant) => ({ type: "plant", plant })),
    });
  }
  const flat = sections.flatMap((s) => s.items);

  // Keep the active option scrolled into view.
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function select(item: Item) {
    if (item.type === "location") {
      navigate({ to: "/map", search: { focus: `${item.loc.lng},${item.loc.lat}`, name: item.loc.name } });
    } else {
      const first = item.plant.specimens[0];
      if (!first) return;
      navigate({ to: "/map", search: { focus: `${first.lng},${first.lat}`, name: item.plant.name } });
    }
  }

  // Walking route to the nearest specimen of a species (plants only).
  function routeToPlant(plant: SpeciesResult, e: React.MouseEvent) {
    e.stopPropagation();
    navigate({ to: "/map", search: { route: plant.name } });
  }

  // Walking route to a fixed location point.
  function routeToLocation(loc: LocationResult, e: React.MouseEvent) {
    e.stopPropagation();
    navigate({ to: "/map", search: { dest: `${loc.lng},${loc.lat}`, destName: loc.name } });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (flat[active]) select(flat[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setQuery("");
    }
  }

  const showResults = flat.length > 0;
  const total = plantResults.length + locResults.length;
  let idx = -1; // running flat index across sections

  return (
    <div className={styles.wrap}>
      <div className={styles.searchBar}>
        <div className={styles.inputWrap} role="combobox" aria-expanded={showResults} aria-haspopup="listbox">
          <span className={styles.searchIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              <circle cx="11" cy="11" r="6.5" />
              <line x1="16" y1="16" x2="21" y2="21" />
            </svg>
          </span>
          <input
            className={styles.input}
            type="text"
            placeholder="Search plants and places, like the Palm House or an oak"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            aria-activedescendant={showResults ? `opt-${active}` : undefined}
            aria-autocomplete="list"
          />
          {query && (
            <button className={styles.clear} onClick={() => setQuery("")} aria-label="Clear search">
              ✕
            </button>
          )}
        </div>
        <div className={styles.status} aria-live="polite">
          {loading
            ? "Searching…"
            : hasQuery
              ? showResults
                ? `${total} result${total === 1 ? "" : "s"}`
                : "No matches"
              : `${browse.length} places to explore, or search for a plant`}
        </div>
      </div>

      <div className={styles.results} role="listbox" ref={listRef}>
        {showResults &&
          sections.map((section) => (
            <section key={section.key} className={styles.section}>
              <div className={styles.sectionHead}>
                <span className={styles.sectionDot} style={{ background: section.color }} />
                <span className={styles.sectionTitle}>{section.heading}</span>
                <span className={styles.sectionCount}>{section.items.length}</span>
              </div>

              {section.items.map((item) => {
                idx += 1;
                const i = idx;
                const selected = i === active;
                if (item.type === "location") {
                  const meta = CATEGORY_META[item.loc.category];
                  return (
                    <div
                      key={`loc-${item.loc.name}`}
                      id={`opt-${i}`}
                      role="option"
                      aria-selected={selected}
                      className={`${styles.locItem} ${selected ? styles.itemActive : ""}`}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => select(item)}
                    >
                      <span className={styles.thumb}>
                        <span className={styles.thumbGlyph} style={{ color: meta.color }} aria-hidden>
                          ❧
                        </span>
                        {item.loc.image && (
                          <img
                            className={styles.thumbImg}
                            src={item.loc.image}
                            alt=""
                            loading="lazy"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        )}
                      </span>
                      <span className={styles.locBody}>
                        <span className={styles.locName}>{highlightMatch(item.loc.name, debounced)}</span>
                        <span className={styles.locMeta}>
                          <span className={styles.catChip} style={{ color: meta.color, borderColor: meta.color }}>
                            {meta.label}
                          </span>
                          {item.loc.detail && <span className={styles.locDetail}>{item.loc.detail}</span>}
                        </span>
                      </span>
                      <button
                        className={styles.navBtn}
                        onClick={(e) => routeToLocation(item.loc, e)}
                        aria-label={`Navigate to ${item.loc.name}`}
                        title="Navigate"
                      >
                        <NavArrow />
                        Navigate
                      </button>
                    </div>
                  );
                }
                const p = item.plant;
                return (
                  <div
                    key={`plant-${p.name}`}
                    id={`opt-${i}`}
                    role="option"
                    aria-selected={selected}
                    className={`${styles.result} ${selected ? styles.itemActive : ""}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => select(item)}
                  >
                    <span className={styles.resultName}>{highlightMatch(p.name, debounced)}</span>
                    <span className={styles.resultMeta}>
                      {p.count > 1 ? `${p.count} specimens` : "1 specimen"}
                    </span>
                    <button
                      className={styles.navBtn}
                      onClick={(e) => routeToPlant(p, e)}
                      aria-label={`Navigate to nearest ${p.name}`}
                      title="Navigate to nearest"
                    >
                      ➜ Navigate
                    </button>
                  </div>
                );
              })}
            </section>
          ))}

        {!loading && hasQuery && flat.length === 0 && (
          <div className={styles.empty}>
            <p>Nothing matches “{debounced}”.</p>
            {suggestions.length > 0 && (
              <p className={styles.suggest}>
                Did you mean{" "}
                {suggestions.map((s, i) => (
                  <button key={s} className={styles.suggestBtn} onClick={() => setQuery(s)}>
                    {s}
                    {i < suggestions.length - 1 ? "," : ""}
                  </button>
                ))}
                ?
              </p>
            )}
          </div>
        )}

        {!hasQuery && browse.length === 0 && (
          <div className={styles.hint}>
            <p>Find anything at Kew.</p>
            <p className={styles.hintSub}>
              8,000+ plants plus glasshouses, gardens, galleries, gates and places to
              eat. Tap a result to fly to it on the map.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
