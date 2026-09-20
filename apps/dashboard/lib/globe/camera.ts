/**
 * Turning a point on the sphere into a pixel.
 *
 * Real 3D: unit vectors, a rotation, a perspective divide and a depth sort. No
 * WebGL and no library. That is a deliberate call, not a shortcut. three.js
 * would add a dependency to the lockfile that apps/api also builds from on
 * Vercel, for a sphere of dots that canvas draws at 60fps anyway. The rotation,
 * the depth and the near-far scaling below are the same maths a shader would do.
 *
 * Pure functions only. test/globe-camera.test.ts covers them.
 */
import type { Vec3 } from "./sphere";

export type Camera = {
  /** Radians around the vertical axis. */
  yaw: number;
  /** Radians around the horizontal axis, clamped by the view. */
  pitch: number;
  /** Camera distance from the centre, in sphere radii. Must be > 1. */
  distance: number;
  /** Half the drawing box, in CSS pixels. The silhouette lands here. */
  radiusPx: number;
  /** Extra magnification used when zoomed into one project. */
  zoom: number;
  centerX: number;
  centerY: number;
};

export type Projected = {
  /** CSS pixels. */
  x: number;
  y: number;
  /** Distance from the camera. Bigger is further away. Sort by this, descending. */
  depth: number;
  /** Near-far size factor. ~0.7 at the back, ~1.6 at the front. */
  perspective: number;
  /** True when the point is on the half of the sphere facing the viewer. */
  front: boolean;
};

export const PITCH_LIMIT = 1.2;

export function clampPitch(pitch: number): number {
  return Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, pitch));
}

/** Yaw about the vertical axis, then pitch about the horizontal one. */
export function rotate(v: Vec3, yaw: number, pitch: number): Vec3 {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x1 = v.x * cy + v.z * sy;
  const z1 = -v.x * sy + v.z * cy;

  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return {
    x: x1,
    y: v.y * cp - z1 * sp,
    z: v.y * sp + z1 * cp,
  };
}

export function project(v: Vec3, cam: Camera): Projected {
  const r = rotate(v, cam.yaw, cam.pitch);
  const depth = cam.distance - r.z;
  const focal = cam.radiusPx * cam.distance * cam.zoom;
  return {
    x: cam.centerX + (r.x * focal) / depth,
    y: cam.centerY - (r.y * focal) / depth,
    depth,
    perspective: cam.distance / depth,
    front: r.z > 0,
  };
}

/**
 * The yaw and pitch that bring `target` to the middle of the view, facing the
 * camera. Used to fly to a project when you click into it.
 */
export function faceTarget(target: Vec3): { yaw: number; pitch: number } {
  const flat = Math.hypot(target.x, target.z);
  return {
    yaw: Math.atan2(-target.x, target.z),
    pitch: clampPitch(Math.atan2(target.y, flat)),
  };
}

/** Shortest signed way from a to b around the circle. Avoids the long way round. */
export function shortestTurn(from: number, to: number): number {
  const twoPi = Math.PI * 2;
  let d = (to - from) % twoPi;
  if (d > Math.PI) d -= twoPi;
  if (d < -Math.PI) d += twoPi;
  return d;
}

/** Frame-rate independent easing towards a target. `rate` per second. */
export function approach(current: number, target: number, rate: number, dt: number): number {
  const k = 1 - Math.exp(-rate * dt);
  return current + (target - current) * k;
}

export function approachAngle(current: number, target: number, rate: number, dt: number): number {
  return current + shortestTurn(current, target) * (1 - Math.exp(-rate * dt));
}

/**
 * Nearest front-facing point to a pixel, within `tolerance` pixels. Back-facing
 * points are never hit, so you cannot click something on the far side of the
 * globe that you cannot see.
 */
export function hitTest<T extends { pos: Vec3 }>(
  items: readonly T[],
  cam: Camera,
  px: number,
  py: number,
  tolerance: number,
): T | null {
  let best: T | null = null;
  let bestDistance = tolerance;
  for (const item of items) {
    const p = project(item.pos, cam);
    if (!p.front) continue;
    const d = Math.hypot(p.x - px, p.y - py);
    if (d <= bestDistance) {
      bestDistance = d;
      best = item;
    }
  }
  return best;
}
