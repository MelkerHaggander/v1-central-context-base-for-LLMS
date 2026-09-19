import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PITCH_LIMIT,
  approach,
  clampPitch,
  faceTarget,
  hitTest,
  project,
  rotate,
  shortestTurn,
  type Camera,
} from "../lib/globe/camera";
import { spiralPoint } from "../lib/globe/sphere";

const camera: Camera = {
  yaw: 0,
  pitch: 0,
  distance: 2.6,
  radiusPx: 200,
  zoom: 1,
  centerX: 300,
  centerY: 300,
};

const length = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z);

describe("globe camera", () => {
  it("rotation turns without stretching", () => {
    for (const v of [spiralPoint(0, 5), spiralPoint(3, 5), { x: 0, y: 1, z: 0 }]) {
      assert.ok(Math.abs(length(rotate(v, 1.1, -0.4)) - 1) < 1e-12);
    }
  });

  it("brings any point to face the camera", () => {
    for (let i = 0; i < 16; i++) {
      const target = spiralPoint(i, 16);
      const { yaw, pitch } = faceTarget(target);
      const seen = rotate(target, yaw, pitch);
      // Pitch is clamped, so a point near a pole lands as close as the view allows.
      if (Math.abs(Math.atan2(target.y, Math.hypot(target.x, target.z))) <= PITCH_LIMIT) {
        assert.ok(seen.z > 0.9999, `i=${i} z=${seen.z}`);
        assert.ok(Math.abs(seen.x) < 1e-9);
        assert.ok(Math.abs(seen.y) < 1e-9);
      } else {
        assert.ok(seen.z > 0, `i=${i} should still be on the near side`);
      }
    }
  });

  it("projects the near pole to the middle and the far pole behind it", () => {
    const near = project({ x: 0, y: 0, z: 1 }, camera);
    assert.equal(Math.round(near.x), camera.centerX);
    assert.equal(Math.round(near.y), camera.centerY);
    assert.ok(near.front);

    const far = project({ x: 0, y: 0, z: -1 }, camera);
    assert.ok(!far.front);
    assert.ok(far.depth > near.depth);
    assert.ok(far.perspective < near.perspective);
  });

  it("keeps the silhouette inside the drawing box", () => {
    for (let i = 0; i < 64; i++) {
      const t = (i / 64) * Math.PI * 2;
      const p = project({ x: Math.cos(t), y: Math.sin(t), z: 0 }, camera);
      const r = Math.hypot(p.x - camera.centerX, p.y - camera.centerY);
      assert.ok(r <= camera.radiusPx + 1e-9, `r=${r}`);
    }
  });

  it("clamps pitch so the globe cannot flip over", () => {
    assert.equal(clampPitch(9), PITCH_LIMIT);
    assert.equal(clampPitch(-9), -PITCH_LIMIT);
    assert.equal(clampPitch(0.3), 0.3);
  });

  it("turns the short way round", () => {
    assert.ok(Math.abs(shortestTurn(0.1, 6.2) + 0.183) < 0.01);
    assert.ok(shortestTurn(0, Math.PI / 2) > 0);
    assert.equal(shortestTurn(1, 1), 0);
  });

  it("eases towards a target without overshooting", () => {
    let value = 0;
    for (let i = 0; i < 200; i++) value = approach(value, 10, 5, 1 / 60);
    assert.ok(value > 9.99 && value <= 10);
  });

  it("never picks a point on the far side of the globe", () => {
    const front = { pos: { x: 0, y: 0, z: 1 } };
    const back = { pos: { x: 0, y: 0, z: -1 } };
    // Both land on the same pixel. Only the visible one may be hit.
    const hit = hitTest([back, front], camera, camera.centerX, camera.centerY, 20);
    assert.equal(hit, front);
    assert.equal(hitTest([back], camera, camera.centerX, camera.centerY, 20), null);
    assert.equal(hitTest([front], camera, 0, 0, 20), null);
  });
});
