import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { AppLayout } from "./views/AppLayout.tsx";
import { MapView } from "./views/MapView.tsx";
import { PdfView } from "./views/PdfView.tsx";
import { SearchView } from "./views/SearchView.tsx";

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
