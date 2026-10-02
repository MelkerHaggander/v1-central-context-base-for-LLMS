/**
 * "Gather": click a colour in the legend and every memory of that category
 * flies to one group in front of the reader, then flies home when the panel
 * closes. Position normally means project; while gathered it means "this
 * category", and the rest of the sphere recedes.
 *
 * Pure maths, no canvas. test/globe-gather.test.ts covers it.
 */
import { normalise, pointInCap, type GlobePoint, type Vec3 } from "./sphere";

/** The unit vector that faces the camera at this yaw and pitch. Inverse of faceTarget(). */
export function frontVector(yaw: number, pitch: number): Vec3 {
  return normalise({
    x: -Math.sin(yaw) * Math.cos(pitch),
    y: Math.sin(pitch),
    z: Math.cos(yaw) * Math.cos(pitch),
  });
}

/** Size of the gathered group: small groups stay tight, big ones get room. Radians. */
export function gatherRadius(count: number): number {
  return Math.min(0.75, 0.22 + 0.035 * Math.max(0, count));
}

/** Where each memory of the category goes. Keyed by id, stable per id. */
export function gatherTargets(
  points: readonly GlobePoint[],
  category: string,
  center: Vec3,
): Map<string, Vec3> {
  const members = points.filter((p) => p.category === category);
  const radius = gatherRadius(members.length);
  const out = new Map<string, Vec3>();
  for (const p of members) out.set(p.id, pointInCap(center, radius, `gather:${p.id}`));
  return out;
}

/** Smooth start and stop. t in [0, 1]. */
export function easeInOut(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

/**
 * Between two points on the sphere. Normalised linear interpolation: cheap,
 * stays on the sphere, and close enough to a great-circle path for the short
 * hops a gather makes. Antipodal pairs are nudged so the midpoint is defined.
 */
export function mixOnSphere(a: Vec3, b: Vec3, t: number): Vec3 {
  const k = Math.min(1, Math.max(0, t));
  const v = {
    x: a.x + (b.x - a.x) * k,
    y: a.y + (b.y - a.y) * k,
    z: a.z + (b.z - a.z) * k,
  };
  if (Math.hypot(v.x, v.y, v.z) < 1e-6) return normalise({ x: v.x + 1e-3, y: v.y + 1e-3, z: v.z });
  return normalise(v);
}

/** The points as they should be drawn right now. Only the category moves. */
export function gatheredPositions(
  points: readonly GlobePoint[],
  targets: ReadonlyMap<string, Vec3>,
  t: number,
): GlobePoint[] {
  if (t <= 0 || targets.size === 0) return points as GlobePoint[];
  const e = easeInOut(t);
  return points.map((p) => {
    const to = targets.get(p.id);
    return to ? { ...p, pos: mixOnSphere(p.pos, to, e) } : p;
  });
}
