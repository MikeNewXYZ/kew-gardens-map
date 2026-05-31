import { describe, expect, it } from "vitest";
import { haversineMeters, nearest, type LngLat } from "./geo.ts";

describe("haversineMeters", () => {
  it("is zero for identical points", () => {
    expect(haversineMeters([-0.2956, 51.4787], [-0.2956, 51.4787])).toBe(0);
  });

  it("approximates a known short distance", () => {
    // ~1 degree of latitude ≈ 111 km.
    const d = haversineMeters([0, 0], [0, 1]);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });
});

describe("nearest", () => {
  const from: LngLat = [-0.2935, 51.481];
  const items: { id: string; c: LngLat }[] = [
    { id: "far", c: [-0.31, 51.47] },
    { id: "near", c: [-0.2936, 51.4811] },
    { id: "mid", c: [-0.298, 51.483] },
  ];

  it("returns the closest item", () => {
    expect(nearest(from, items, (i) => i.c)?.id).toBe("near");
  });

  it("returns null for an empty list", () => {
    expect(nearest(from, [], (i: { c: LngLat }) => i.c)).toBeNull();
  });
});
