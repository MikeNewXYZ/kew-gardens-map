import { describe, expect, it } from "vitest";
import type { PlantCollection } from "./plants.ts";
import {
  formatDistance,
  formatDuration,
  haversine,
  nearestNamed,
  type LngLat,
} from "./nav.ts";

describe("haversine", () => {
  it("is zero for identical points", () => {
    expect(haversine([-0.2956, 51.4787], [-0.2956, 51.4787])).toBe(0);
  });

  it("approximates one degree of latitude (~111 km)", () => {
    const d = haversine([0, 0], [0, 1]);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });
});

function plant(name: string, lng: number, lat: number): PlantCollection["features"][number] {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties: { name, genus: name.split(" ")[0], accession: `${name}-${lng}`, fid: `${lng}` },
  };
}

const DATA: PlantCollection = {
  type: "FeatureCollection",
  features: [
    plant("Quercus robur", -0.31, 51.47),
    plant("Ginkgo biloba", -0.2936, 51.4811), // closest to `from`
    plant("Ginkgo biloba", -0.305, 51.49),
  ],
};

describe("nearestNamed", () => {
  const from: LngLat = [-0.2935, 51.481];

  it("returns the closest specimen of the named species", () => {
    const hit = nearestNamed(from, DATA, "Ginkgo biloba");
    expect(hit?.coords).toEqual([-0.2936, 51.4811]);
    expect(hit?.metres).toBeGreaterThan(0);
  });

  it("is case-insensitive on the name", () => {
    expect(nearestNamed(from, DATA, "ginkgo biloba")?.name).toBe("Ginkgo biloba");
  });

  it("returns null when nothing matches", () => {
    expect(nearestNamed(from, DATA, "Acer palmatum")).toBeNull();
  });
});

describe("formatting", () => {
  it("formats distance in m below 1 km and km above", () => {
    expect(formatDistance(450)).toBe("450 m");
    expect(formatDistance(1500)).toBe("1.5 km");
  });

  it("formats duration in whole minutes", () => {
    expect(formatDuration(20)).toBe("<1 min");
    expect(formatDuration(180)).toBe("3 min");
  });
});
