import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { faceTarget } from "../lib/globe/camera";
import {
  easeInOut,
  frontVector,
  gatherRadius,
  gatherTargets,
  gatheredPositions,
  mixOnSphere,
} from "../lib/globe/gather";
import { angleBetween, type GlobePoint } from "../lib/globe/sphere";

const unit = (v: { x: number; y: number; z: number }) => Math.abs(Math.hypot(v.x, v.y, v.z) - 1) < 1e-9;

function pts(): GlobePoint[] {
  const cats = ["deadline", "fact", "deadline", "goal", "deadline"];
  return cats.map((category, i) => ({
    id: `id-${i}`,
    project: "P",
    category,
    pos: { x: Math.cos(i), y: 0, z: Math.sin(i) },
  }));
}

describe("gather", () => {
  it("frontVector is the inverse of faceTarget", () => {
    for (const [yaw, pitch] of [
      [0, 0],
      [0.6, 0.28],
      [-2.1, -0.4],
    ]) {
      const v = frontVector(yaw, pitch);
      const back = faceTarget(v);
      assert.ok(Math.abs(Math.atan2(Math.sin(back.yaw - yaw), Math.cos(back.yaw - yaw))) < 1e-9);
      assert.ok(Math.abs(back.pitch - pitch) < 1e-9);
    }
  });

  it("moves only the chosen category, each into the group around the centre", () => {
    const center = frontVector(0.3, 0.1);
    const targets = gatherTargets(pts(), "deadline", center);
    assert.deepEqual([...targets.keys()].sort(), ["id-0", "id-2", "id-4"]);
    for (const v of targets.values()) {
      assert.ok(unit(v));
      assert.ok(angleBetween(center, v) <= gatherRadius(3) + 1e-9);
    }
  });

  it("is where it was at t=0 and at the target at t=1, and stays on the sphere between", () => {
    const points = pts();
    const targets = gatherTargets(points, "deadline", frontVector(0, 0));
    assert.equal(gatheredPositions(points, targets, 0), points);
    const done = gatheredPositions(points, targets, 1);
    for (const p of done) {
      const to = targets.get(p.id);
      if (to) assert.ok(angleBetween(p.pos, to) < 1e-6);
      else assert.deepEqual(p.pos, points.find((q) => q.id === p.id)!.pos);
    }
    for (const p of gatheredPositions(points, targets, 0.5)) assert.ok(unit(p.pos));
  });

  it("gives the same spot to the same memory every time", () => {
    const a = gatherTargets(pts(), "deadline", frontVector(1, 0.2));
    const b = gatherTargets(pts(), "deadline", frontVector(1, 0.2));
    assert.deepEqual([...a.entries()], [...b.entries()]);
  });

  it("eases from 0 to 1 and survives an antipodal hop", () => {
    assert.equal(easeInOut(0), 0);
    assert.equal(easeInOut(1), 1);
    assert.ok(easeInOut(0.25) < 0.25 && easeInOut(0.75) > 0.75);
    assert.ok(unit(mixOnSphere({ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, 0.5)));
  });
});
