import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";
import { AppLayout } from "./views/AppLayout.tsx";

// Code-split each tab: the map chunk carries mapbox-gl, search carries
// minisearch, and the guide carries pdf.js/react-pdf — so visiting the map no
// longer downloads the (heavy) PDF viewer or the search index.
const MapView = lazyRouteComponent(() => import("./views/MapView.tsx"), "MapView");
const SearchView = lazyRouteComponent(() => import("./views/SearchView.tsx"), "SearchView");
const PdfView = lazyRouteComponent(() => import("./views/PdfView.tsx"), "PdfView");

const rootRoute = createRootRoute({ component: AppLayout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/map" });
  },
});

const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/search",
  component: SearchView,
});

export interface MapSearch {
  focus?: string; // "lng,lat"
  name?: string;
  route?: string; // plant name to navigate to the nearest of
  dest?: string; // "lng,lat" of a fixed destination (e.g. a location) to walk to
  destName?: string; // label for the dest destination
}

const mapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/map",
  validateSearch: (s: Record<string, unknown>): MapSearch => ({
    focus: typeof s.focus === "string" ? s.focus : undefined,
    name: typeof s.name === "string" ? s.name : undefined,
    route: typeof s.route === "string" ? s.route : undefined,
    dest: typeof s.dest === "string" ? s.dest : undefined,
    destName: typeof s.destName === "string" ? s.destName : undefined,
  }),
  component: MapView,
});

const pdfRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pdf",
  component: PdfView,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  searchRoute,
  mapRoute,
  pdfRoute,
]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
