import { describe, expect, it } from "vitest";
import type { PlantCollection } from "./plants.ts";
import { createPlantIndex, groupResults, searchIndex } from "./search.ts";

type Feature = PlantCollection["features"][number];

function feat(name: string, genus: string, accession: string, lng: number, lat: number): Feature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties: { name, genus, accession, fid: accession },
  };
}

const FEATURES: Feature[] = [
  feat("Ginkgo biloba", "Ginkgo", "2019-1*1", -0.28, 51.48),
  feat("Ginkgo biloba", "Ginkgo", "2019-2*1", -0.281, 51.481),
  feat("Quercus robur", "Quercus", "2018-5*1", -0.29, 51.47),
  feat("Acer palmatum", "Acer", "2020-9*1", -0.3, 51.49),
  feat("Acer campestre", "Acer", "2020-10*1", -0.301, 51.491),
];

const index = createPlantIndex(FEATURES);

describe("searchIndex", () => {
  it("ignores queries shorter than 2 characters", () => {
    expect(searchIndex(index, "g")).toEqual([]);
    expect(searchIndex(index, " ")).toEqual([]);
  });

  it("matches by prefix (gink -> Ginkgo)", () => {
    const r = searchIndex(index, "gink");
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe("Ginkgo biloba");
  });

  it("tolerates typos via fuzzy matching (ginko -> Ginkgo)", () => {
    const r = searchIndex(index, "ginko");
    expect(r.map((g) => g.name)).toContain("Ginkgo biloba");
  });

  it("matches by genus and returns all species in it", () => {
    const names = searchIndex(index, "acer").map((g) => g.name);
    expect(names).toContain("Acer palmatum");
    expect(names).toContain("Acer campestre");
  });

  it("groups duplicate specimens under one species with a count", () => {
    const [ginkgo] = searchIndex(index, "ginkgo biloba");
    expect(ginkgo.name).toBe("Ginkgo biloba");
    expect(ginkgo.count).toBe(2);
    expect(ginkgo.specimens).toHaveLength(2);
  });

  it("respects the result limit", () => {
    expect(searchIndex(index, "a", 1)).toEqual([]); // too short
    expect(searchIndex(index, "acer", 1)).toHaveLength(1);
  });
});

describe("groupResults", () => {
  it("keeps the highest score per group and sorts descending", () => {
    const raw = [
      { id: 1, score: 2, terms: [], queryTerms: [], match: {}, name: "A", genus: "A", accession: "x", lng: 0, lat: 0 },
      { id: 2, score: 9, terms: [], queryTerms: [], match: {}, name: "B", genus: "B", accession: "y", lng: 0, lat: 0 },
      { id: 3, score: 5, terms: [], queryTerms: [], match: {}, name: "A", genus: "A", accession: "z", lng: 0, lat: 0 },
    ];
    const grouped = groupResults(raw);
    expect(grouped.map((g) => g.name)).toEqual(["B", "A"]);
    expect(grouped[1].score).toBe(5);
    expect(grouped[1].count).toBe(2);
  });
});
