import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  angleBetween,
  buildClusters,
  buildLayout,
  hash32,
  minCentreSeparation,
  pointInCap,
  spiralPoint,
  unitPair,
} from "../lib/globe/sphere";
import type { Memory } from "../lib/types";

const isUnit = (v: { x: number; y: number; z: number }) =>
  Math.abs(Math.hypot(v.x, v.y, v.z) - 1) < 1e-9;

function memory(id: string, project: string, category: Memory["category"]): Memory {
  return {
    id,
    project,
    category,
    title: `t-${id}`,
    content: "c",
    created_at: "2026-09-10T12:00:00Z",
    updated_at: "2026-09-10T12:00:00Z",
  };
}

describe("globe layout", () => {
  it("hashes the same string to the same number, every time", () => {
    assert.equal(hash32("a0010000-0000-4000-8000-000000000001"), hash32("a0010000-0000-4000-8000-000000000001"));
    assert.notEqual(hash32("one"), hash32("two"));
    const [u, v] = unitPair("seed");
    assert.ok(u >= 0 && u < 1);
    assert.ok(v >= 0 && v < 1);
    assert.notEqual(u, v);
  });

  it("spreads zone centres over the sphere as unit vectors", () => {
    for (let n = 1; n <= 12; n++) {
      for (let i = 0; i < n; i++) assert.ok(isUnit(spiralPoint(i, n)), `n=${n} i=${i}`);
    }
    // More projects means the centres sit closer together, never further apart.
    const few = minCentreSeparation([0, 1, 2].map((i) => spiralPoint(i, 3)));
    const many = minCentreSeparation(Array.from({ length: 12 }, (_, i) => spiralPoint(i, 12)));
    assert.ok(many < few);
  });

  it("keeps a memory inside its own project's zone", () => {
    const center = spiralPoint(2, 7);
    const radius = 0.4;
    for (const seed of ["a", "b", "ccc", "550e8400-e29b-41d4-a716-446655440000"]) {
      const p = pointInCap(center, radius, seed);
      assert.ok(isUnit(p));
      assert.ok(angleBetween(center, p) <= radius + 1e-9, seed);
    }
  });

  it("puts the same memory in the same place on every render", () => {
    const rows = [memory("id-1", "P", "fact"), memory("id-2", "P", "goal")];
    const a = buildLayout(rows);
    const b = buildLayout(rows);
    assert.deepEqual(a.points, b.points);
  });

  it("does not move a project because it gained a memory", () => {
    const before = buildClusters(new Map([["Alpha", 1], ["Beta", 9]]));
    const after = buildClusters(new Map([["Alpha", 40], ["Beta", 9]]));
    const pick = (list: typeof before, name: string) => list.find((c) => c.project === name)!;
    // Centres are keyed on the sorted name, so only the radius may change.
    assert.deepEqual(pick(before, "Alpha").center, pick(after, "Alpha").center);
    assert.deepEqual(pick(before, "Beta").center, pick(after, "Beta").center);
    assert.ok(pick(after, "Alpha").radius > pick(before, "Alpha").radius);
  });

  it("keeps two zones from touching", () => {
    const counts = new Map(["A", "B", "C", "D", "E", "F"].map((p) => [p, 10]));
    const clusters = buildClusters(counts);
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const gap = angleBetween(clusters[i].center, clusters[j].center);
        assert.ok(
          gap > clusters[i].radius + clusters[j].radius,
          `zones ${clusters[i].project} and ${clusters[j].project} overlap`,
        );
      }
    }
  });

  it("lets a single project fill the whole sphere", () => {
    const [only] = buildClusters(new Map([["Solo", 3]]));
    assert.equal(only.radius, Math.PI);
  });

  it("drops nothing and invents nothing", () => {
    const rows = [
      memory("1", "A", "fact"),
      memory("2", "A", "lesson"),
      memory("3", "B", "deadline"),
    ];
    const layout = buildLayout(rows);
    assert.equal(layout.points.length, 3);
    assert.equal(layout.clusters.length, 2);
    assert.deepEqual(
      layout.points.map((p) => p.id).sort(),
      ["1", "2", "3"],
    );
    assert.equal(layout.clusters.find((c) => c.project === "A")!.count, 2);
  });

  it("handles an empty account", () => {
    const layout = buildLayout([]);
    assert.deepEqual(layout.points, []);
    assert.deepEqual(layout.clusters, []);
  });
});
