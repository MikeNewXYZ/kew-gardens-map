/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAPBOX_TOKEN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// pdf.js worker, emitted as a hashed asset URL by Vite (see PdfView).
declare module "pdfjs-dist/build/pdf.worker.min.mjs?url" {
  const src: string;
  export default src;
}

// @mapbox/mapbox-gl-directions ships no types — minimal surface we use.
declare module "@mapbox/mapbox-gl-directions" {
  interface DirectionsOptions {
    accessToken?: string;
    unit?: "imperial" | "metric";
    profile?: "mapbox/driving-traffic" | "mapbox/driving" | "mapbox/walking" | "mapbox/cycling";
    alternatives?: boolean;
    congestion?: boolean;
    interactive?: boolean;
    flyTo?: boolean;
    controls?: { inputs?: boolean; instructions?: boolean; profileSwitcher?: boolean };
    placeholderOrigin?: string;
    placeholderDestination?: string;
  }
  export default class MapboxDirections {
    constructor(options?: DirectionsOptions);
    setOrigin(query: string | [number, number]): this;
    setDestination(query: string | [number, number]): this;
    removeRoutes(): this;
    on(type: string, fn: (e: unknown) => void): this;
    onAdd(map: unknown): HTMLElement;
    onRemove(map: unknown): void;
  }
}
