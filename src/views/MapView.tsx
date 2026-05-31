import { useNavigate, useSearch } from "@tanstack/react-router";
import mapboxgl from "mapbox-gl";
import { useEffect, useRef, useState } from "react";
import {
  buildGenusStyle,
  loadPlants,
  type GenusStyle,
  type PlantProps,
} from "../lib/plants.ts";
import {
  fetchWalkingRoute,
  formatDistance,
  formatDuration,
  haversine,
  nearestNamed,
  resolveStart,
  type LngLat,
} from "../lib/nav.ts";
import { createMap } from "../map.ts";
import { usePresence } from "../lib/presence.tsx";
import styles from "./MapView.module.css";

const SOURCE = "plants";
const BOUNDARY = "kew-boundary";
const MASK = "kew-mask";
const ROUTE = "nav-route";

const idle = (cb: () => void) =>
  window.requestIdleCallback
    ? window.requestIdleCallback(() => cb(), { timeout: 2000 })
    : window.setTimeout(cb, 1);

interface NavInfo {
  label: string; // "Nearest specimen" for plants, "Walking route" for places
  name: string;
  metres: number;
  seconds: number | null; // null when only a straight-line fallback is shown
}

export function MapView() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as {
    focus?: string;
    name?: string;
    route?: string;
    dest?: string;
    destName?: string;
  };
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const hoverPopupRef = useRef<mapboxgl.Popup | null>(null);
  // Stable handle to navigate() for use inside once-registered map handlers.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const navMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const presenceMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const { myId, users } = usePresence();

  const [genusStyle, setGenusStyle] = useState<GenusStyle | null>(null);
  const [loading, setLoading] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [nav, setNav] = useState<NavInfo | null>(null);
  const [navError, setNavError] = useState<string | null>(null);
  const [threeD, setThreeD] = useState(true); // map starts pitched (pitch 55)

  // Create the map + plant layers once.
  useEffect(() => {
    if (!containerRef.current) return;

    // Perf (waterfall): kick off the data fetch in parallel with map creation.
    const dataPromise = loadPlants();
    const map = createMap(containerRef.current);
    mapRef.current = map;

    const hoverPopup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
      className: "plant-tip",
    });
    hoverPopupRef.current = hoverPopup;

    // Defer 3D terrain — non-critical, added once the map is idle.
    map.on("style.load", () => {
      idle(() => {
        if (map.getSource("dem") == null) {
          map.addSource("dem", {
            type: "raster-dem",
            url: "mapbox://mapbox.mapbox-terrain-dem-v1",
            tileSize: 512,
            maxzoom: 14,
          });
        }
        map.setTerrain({ source: "dem", exaggeration: 1.3 });
      });
    });

    map.on("load", () => {
      setMapReady(true);

      // Grey out everything outside the gardens: a world-covering polygon with
      // the Kew boundary cut out as a hole.
      if (!map.getSource(MASK)) {
        map.addSource(MASK, { type: "geojson", data: "/kew-mask.geojson" });
        map.addLayer({
          id: "boundary-mask",
          type: "fill",
          source: MASK,
          slot: "middle",
          paint: { "fill-color": "#1a1a1a", "fill-opacity": 0.45 },
        });
      }

      // Outline of the Royal Botanic Gardens, Kew (OSM protected-area boundary).
      if (!map.getSource(BOUNDARY)) {
        map.addSource(BOUNDARY, { type: "geojson", data: "/kew-boundary.geojson" });
        map.addLayer({
          id: "boundary-fill",
          type: "fill",
          source: BOUNDARY,
          slot: "middle",
          paint: { "fill-color": "#2d6a4f", "fill-opacity": 0.06 },
        });
        map.addLayer({
          id: "boundary-line",
          type: "line",
          source: BOUNDARY,
          slot: "middle",
          layout: { "line-join": "round" },
          paint: {
            "line-color": "#1b4332",
            "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1.5, 16, 3.5],
            "line-opacity": 0.9,
          },
        });
      }

      // Walking-route line (start empty; populated when navigating). A casing
      // under the main line keeps it legible over busy ground textures.
      if (!map.getSource(ROUTE)) {
        const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
        map.addSource(ROUTE, { type: "geojson", data: empty });
        map.addLayer({
          id: "nav-route-casing",
          type: "line",
          source: ROUTE,
          slot: "top",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#ffffff", "line-width": 9, "line-opacity": 0.9 },
        });
        map.addLayer({
          id: "nav-route-line",
          type: "line",
          source: ROUTE,
          slot: "top",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": "#1d6feb",
            "line-width": 5,
            "line-emissive-strength": 1,
          },
        });
      }

      void dataPromise.then((data) => {
        if (map.getSource(SOURCE)) return;
        const gstyle = buildGenusStyle(data);
        setGenusStyle(gstyle);

        map.addSource(SOURCE, {
          type: "geojson",
          data,
          cluster: true,
          clusterMaxZoom: 16,
          clusterRadius: 46,
        });

        // 1. Density heatmap — overview at low zoom, fades out as clusters take over.
        map.addLayer({
          id: "plant-heat",
          type: "heatmap",
          source: SOURCE,
          slot: "top",
          maxzoom: 16.5,
          paint: {
            "heatmap-weight": 1,
            "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 11, 0.6, 16, 1.3],
            "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 11, 8, 16, 28],
            "heatmap-color": [
              "interpolate", ["linear"], ["heatmap-density"],
              0, "rgba(0,68,27,0)",
              0.2, "#74c476",
              0.4, "#41ab5d",
              0.6, "#238b45",
              0.8, "#006d2c",
              1, "#00441b",
            ],
            "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0.8, 16.5, 0],
          },
        } as mapboxgl.LayerSpecification);

        // 2. Clusters — sequential green ramp, emissive so they glow at dusk/night.
        map.addLayer({
          id: "clusters",
          type: "circle",
          source: SOURCE,
          filter: ["has", "point_count"],
          slot: "top",
          paint: {
            "circle-color": ["step", ["get", "point_count"], "#74c476", 50, "#41ab5d", 200, "#238b45", 750, "#005a32"],
            "circle-radius": ["step", ["get", "point_count"], 16, 50, 20, 200, 26, 750, 34],
            "circle-opacity": 0.92,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
            "circle-emissive-strength": 1,
          },
        } as mapboxgl.LayerSpecification);
        map.addLayer({
          id: "cluster-count",
          type: "symbol",
          source: SOURCE,
          filter: ["has", "point_count"],
          slot: "top",
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-font": ["DIN Pro Medium", "Arial Unicode MS Bold"],
            "text-size": 13,
          },
          paint: { "text-color": "#ffffff" },
        } as mapboxgl.LayerSpecification);

        // 3. Individual plants — coloured by genus (data-driven categorical).
        map.addLayer({
          id: "plant-point",
          type: "circle",
          source: SOURCE,
          filter: ["!", ["has", "point_count"]],
          slot: "top",
          paint: {
            "circle-color": gstyle.colorExpression as unknown as mapboxgl.ExpressionSpecification,
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 3, 17, 5, 19.5, 8],
            "circle-stroke-width": 1,
            "circle-stroke-color": "rgba(255,255,255,0.9)",
            "circle-emissive-strength": 1,
          },
        } as mapboxgl.LayerSpecification);

        // Expand a cluster on click (true expansion zoom, not a fixed step).
        map.on("click", "clusters", (e) => {
          const f = map.queryRenderedFeatures(e.point, { layers: ["clusters"] })[0];
          if (!f || f.geometry.type !== "Point") return;
          const clusterId = f.properties?.cluster_id as number;
          const src = map.getSource(SOURCE) as mapboxgl.GeoJSONSource;
          src.getClusterExpansionZoom(clusterId, (err, zoom) => {
            if (err || zoom == null) return;
            map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom });
          });
        });

        // Reusable hover tooltip for individual plants (perf: one popup instance).
        map.on("mousemove", "plant-point", (e) => {
          const f = e.features?.[0];
          if (!f || f.geometry.type !== "Point") return;
          map.getCanvas().style.cursor = "pointer";
          const p = f.properties as PlantProps;
          hoverPopup
            .setLngLat(f.geometry.coordinates as [number, number])
            .setHTML(popupHTML(p.name, p.accession))
            .addTo(map);
        });
        map.on("mouseleave", "plant-point", () => {
          map.getCanvas().style.cursor = "";
          hoverPopup.remove();
        });

        // Click a plant for a pinned popup with a Navigate button (touch too).
        map.on("click", "plant-point", (e) => {
          const f = e.features?.[0];
          if (!f || f.geometry.type !== "Point") return;
          const p = f.properties as PlantProps;
          const coords = f.geometry.coordinates as [number, number];
          new mapboxgl.Popup({ offset: 12 })
            .setLngLat(coords)
            .setDOMContent(
              popupContent(p.name, p.accession, () =>
                navigateRef.current({
                  to: "/map",
                  search: { dest: `${coords[0]},${coords[1]}`, destName: p.name },
                }),
              ),
            )
            .addTo(map);
        });

        map.on("mouseenter", "clusters", () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", "clusters", () => (map.getCanvas().style.cursor = ""));

        map.once("idle", () => setLoading(false));
      });
    });

    return () => {
      hoverPopup.remove();
      presenceMarkersRef.current.forEach((m) => m.remove());
      presenceMarkersRef.current.clear();
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  // Live visitor markers: one emoji bubble per user, reconciled as the shared
  // presence state changes. Users outside the gardens / stale (>30 min) drop out
  // automatically because the Durable Object removes them from the broadcast.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const markers = presenceMarkersRef.current;
    const seen = new Set<string>();

    for (const [id, u] of Object.entries(users)) {
      if (u.lng == null || u.lat == null) continue;
      seen.add(id);
      let marker = markers.get(id);
      if (!marker) {
        const el = document.createElement("div");
        el.className = styles.presence;
        const popup = new mapboxgl.Popup({ offset: 24, closeButton: false }).setHTML(
          presencePopupHTML(u.emoji, id === myId),
        );
        marker = new mapboxgl.Marker({ element: el })
          .setLngLat([u.lng, u.lat])
          .setPopup(popup)
          .addTo(map);
        markers.set(id, marker);
      }
      const el = marker.getElement();
      el.textContent = u.emoji;
      el.classList.toggle(styles.presenceSelf, id === myId);
      marker.setLngLat([u.lng, u.lat]);
    }

    for (const [id, marker] of markers) {
      if (!seen.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    }
  }, [users, myId, mapReady]);

  // Fly to a plant selected from the Search tab.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !search.focus) return;
    const [lng, lat] = search.focus.split(",").map(Number);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

    const go = () => {
      map.flyTo({ center: [lng, lat], zoom: 19, pitch: 55, duration: 1400 });
      const label = search.name ?? "Selected point";
      new mapboxgl.Popup({ offset: 12 })
        .setLngLat([lng, lat])
        .setDOMContent(
          popupContent(label, undefined, () =>
            navigateRef.current({ to: "/map", search: { dest: `${lng},${lat}`, destName: label } }),
          ),
        )
        .addTo(map);
    };
    if (map.isStyleLoaded()) go();
    else map.once("load", go);
  }, [search.focus, search.name]);

  // Navigate: draw a walking route from the visitor's GPS to either the nearest
  // specimen of a plant (search.route) or a fixed location (search.dest).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const routeName = search.route;
    const destStr = search.dest;
    if (!routeName && !destStr) {
      clearRoute(map, navMarkersRef);
      setNav(null);
      setNavError(null);
      return;
    }

    let cancelled = false;
    setNavError(null);

    async function run() {
      // Always start from the visitor's real GPS position.
      const from = await resolveStart();
      if (cancelled || !map) return;
      if (!from) {
        setNav(null);
        setNavError("Couldn't get your location — enable location access to navigate.");
        return;
      }

      let destCoords: LngLat;
      let destName: string;
      let label: string;
      let straightMetres: number;

      if (routeName) {
        // Geometric narrowing (nearest as the crow flies), then route the winner.
        const data = await loadPlants();
        if (cancelled || !map) return;
        const hit = nearestNamed(from, data, routeName);
        if (!hit) {
          setNav(null);
          setNavError(`Couldn't find “${routeName}” in the collection.`);
          return;
        }
        destCoords = hit.coords;
        destName = hit.name;
        label = "Nearest specimen";
        straightMetres = hit.metres;
      } else {
        const [lng, lat] = destStr!.split(",").map(Number);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
          setNav(null);
          setNavError("Invalid destination.");
          return;
        }
        destCoords = [lng, lat];
        destName = search.destName ?? "Destination";
        label = "Walking route";
        straightMetres = haversine(from, destCoords);
      }

      const route = await fetchWalkingRoute(from, destCoords);
      if (cancelled || !map) return;

      drawRoute(map, navMarkersRef, from, destCoords, destName, route?.geometry);
      setNav({
        label,
        name: destName,
        metres: route?.metres ?? straightMetres,
        seconds: route?.seconds ?? null,
      });
    }

    const start = () => void run();
    if (map.isStyleLoaded()) start();
    else map.once("load", start);
    return () => {
      cancelled = true;
    };
  }, [search.route, search.dest, search.destName]);

  // Toggle between the pitched 3D view and a flat top-down 2D view.
  function toggle3D() {
    const map = mapRef.current;
    if (!map) return;
    const next = !threeD;
    setThreeD(next);
    map.easeTo({ pitch: next ? 55 : 0, bearing: next ? -20 : 0, duration: 800 });
  }

  // Keep the button label honest if the user pitches manually (e.g. drag, or
  // the NavigationControl): >10° counts as 3D.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const onPitch = () => setThreeD(map.getPitch() > 10);
    map.on("pitchend", onPitch);
    return () => {
      map.off("pitchend", onPitch);
    };
  }, [mapReady]);

  function endNavigation() {
    const map = mapRef.current;
    if (map) clearRoute(map, navMarkersRef);
    setNav(null);
    setNavError(null);
    navigate({ to: "/map", search: {} });
  }

  return (
    <div className={styles.wrap}>
      <div ref={containerRef} className={styles.map} />

      {loading && <div className={styles.loading}>Loading plants…</div>}

      {mapReady && (
        <button
          type="button"
          className={styles.viewToggle}
          onClick={toggle3D}
          aria-pressed={threeD}
          title={threeD ? "Switch to 2D (top-down) view" : "Switch to 3D view"}
        >
          {threeD ? "2D" : "3D"}
        </button>
      )}

      {(nav || navError) && (
        <div className={styles.navPanel}>
          {nav ? (
            <div className={styles.navBody}>
              <div className={styles.navLabel}>{nav.label}</div>
              <div className={styles.navName}>{nav.name}</div>
              <div className={styles.navStats}>
                {formatDistance(nav.metres)}
                {nav.seconds != null && ` · ${formatDuration(nav.seconds)} walk`}
              </div>
            </div>
          ) : (
            <div className={styles.navBody}>
              <div className={styles.navName}>{navError}</div>
            </div>
          )}
          <button
            type="button"
            className={styles.navClose}
            onClick={endNavigation}
            aria-label="End navigation"
          >
            ×
          </button>
        </div>
      )}

      {genusStyle && !legendOpen && (
        <button
          type="button"
          className={styles.legendToggle}
          onClick={() => setLegendOpen(true)}
          aria-expanded={false}
        >
          🌿 Key
        </button>
      )}

      {genusStyle && legendOpen && (
        <div className={styles.legend}>
          <div className={styles.legendHeader}>
            <span className={styles.legendTitle}>Most-planted genera</span>
            <button
              type="button"
              className={styles.legendClose}
              onClick={() => setLegendOpen(false)}
              aria-label="Hide key"
            >
              ×
            </button>
          </div>
          {genusStyle.legend.map((l) => (
            <div key={l.genus} className={styles.legendRow}>
              <span className={styles.swatch} style={{ background: l.color }} />
              <span className={styles.legendName}>{l.genus}</span>
              <span className={styles.legendCount}>{l.count.toLocaleString()}</span>
            </div>
          ))}
          <div className={styles.legendRow}>
            <span className={styles.swatch} style={{ background: genusStyle.otherColor }} />
            <span className={styles.legendName}>Other</span>
          </div>
        </div>
      )}
    </div>
  );
}

function popupHTML(name: string, accession?: string) {
  const acc = accession ? `<div class="plant-popup-acc">${accession}</div>` : "";
  return `<div class="plant-popup"><em>${name}</em>${acc}</div>`;
}

function presencePopupHTML(emoji: string, isSelf: boolean) {
  const label = isSelf ? "Your last known location" : "Last known location";
  return `<div class="presence-popup"><span class="presence-emoji">${emoji}</span><span>${label}</span></div>`;
}

/**
 * Build popup content as a DOM node (so the Navigate button can fire a real
 * handler). `onNavigate` draws a walking route to this point.
 */
function popupContent(name: string, accession: string | undefined, onNavigate: () => void): HTMLElement {
  const root = document.createElement("div");
  root.className = "plant-popup";

  const title = document.createElement("em");
  title.textContent = name;
  root.appendChild(title);

  if (accession) {
    const acc = document.createElement("div");
    acc.className = "plant-popup-acc";
    acc.textContent = accession;
    root.appendChild(acc);
  }

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "plant-popup-nav";
  btn.textContent = "➜ Navigate here";
  btn.addEventListener("click", onNavigate);
  root.appendChild(btn);

  return root;
}

type MarkersRef = React.MutableRefObject<mapboxgl.Marker[]>;

/** Draw the walking route line + start/destination markers and frame them. */
function drawRoute(
  map: mapboxgl.Map,
  markersRef: MarkersRef,
  from: LngLat,
  to: LngLat,
  destName: string,
  geometry?: GeoJSON.LineString,
) {
  // Fall back to a straight line if the Directions API is unavailable.
  const line: GeoJSON.LineString = geometry ?? { type: "LineString", coordinates: [from, to] };
  const src = map.getSource(ROUTE) as mapboxgl.GeoJSONSource | undefined;
  src?.setData({ type: "Feature", properties: {}, geometry: line });

  markersRef.current.forEach((m) => m.remove());
  markersRef.current = [
    new mapboxgl.Marker({ color: "#1d6feb" }).setLngLat(from).addTo(map),
    new mapboxgl.Marker({ color: "#d62828" })
      .setLngLat(to)
      .setPopup(new mapboxgl.Popup({ offset: 24 }).setHTML(popupHTML(destName)))
      .addTo(map),
  ];

  const bounds = line.coordinates.reduce(
    (b, c) => b.extend(c as [number, number]),
    new mapboxgl.LngLatBounds(from, from),
  );
  map.fitBounds(bounds, {
    padding: { top: 90, bottom: 200, left: 60, right: 60 },
    pitch: 45,
    maxZoom: 19,
    duration: 1200,
  });
}

/** Remove the route line and its markers. */
function clearRoute(map: mapboxgl.Map, markersRef: MarkersRef) {
  const src = map.getSource(ROUTE) as mapboxgl.GeoJSONSource | undefined;
  src?.setData({ type: "FeatureCollection", features: [] });
  markersRef.current.forEach((m) => m.remove());
  markersRef.current = [];
}
