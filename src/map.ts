import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

// Royal Botanic Gardens, Kew — framed on the glasshouse cluster.
export const KEW_CENTER: [number, number] = [-0.2935, 51.481];

/** Standard-style lighting presets (drive sun position, shadows, sky colour). */
export type LightPreset = "dawn" | "day" | "dusk" | "night";
export const DEFAULT_LIGHT: LightPreset = "day";

export function createMap(container: HTMLElement): mapboxgl.Map {
  const map = new mapboxgl.Map({
    container,
    // Standard style (GL JS v3): real 3D buildings, trees and lighting.
    style: "mapbox://styles/mapbox/standard",
    // Initial Standard-style config so 3D objects + lighting are correct from frame 1.
    config: {
      basemap: { lightPreset: DEFAULT_LIGHT, show3dObjects: true },
    },
    center: KEW_CENTER,
    zoom: 15.2,
    pitch: 55,
    bearing: -20,
    maxPitch: 80,
    maxZoom: 19.5,
    antialias: true,
  });

  map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-right");
  // Keep the "centre on me" button, but hide the native blue location dot — the
  // visitor's own position is represented by their assigned presence emoji.
  map.addControl(
    new mapboxgl.GeolocateControl({
      trackUserLocation: true,
      showUserLocation: false,
    }),
    "top-right",
  );
  map.addControl(new mapboxgl.ScaleControl({ unit: "metric" }), "bottom-left");

  return map;
}
