/**
 * Where a memory sits on the globe.
 *
 * The rule the view depends on: position means project, colour means category.
 * Every project gets its own zone on the sphere, and the memories of that
 * project are scattered inside the zone. Nothing here is random at runtime: a
 * memory's point is derived from its id, so it keeps the same spot across
 * refreshes, re-renders and reloads. A dot that jumped every ten seconds would
 * make the globe unreadable.
 *
 * Pure functions only. No DOM, no canvas, no React. test/globe-sphere.test.ts
 * covers determinism, containment and separation.
 */
import type { Memory } from "../types";

export type Vec3 = { x: number; y: number; z: number };

export type Cluster = {
  project: string;
  /** Unit vector: the middle of this project's zone. */
  center: Vec3;
  /** Angular radius of the zone, in radians. */
  radius: number;
  count: number;
};

export type GlobePoint = {
  id: string;
  project: string;
  category: string;
  /** Unit vector on the sphere. */
  pos: Vec3;
};

export type GlobeLayout = {
  clusters: Cluster[];
  points: GlobePoint[];
};

/** Widest a zone may get, so two neighbouring projects never merge visually. */
const MAX_ZONE_RADIUS = 0.62;
/** Narrowest, so a one-memory project is still a visible dot and not a pinprick. */
const MIN_ZONE_FACTOR = 0.4;

/** FNV-1a. Small, fast, and identical in every JS engine. */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Two independent, stable numbers in [0, 1) from one string. */
export function unitPair(input: string): [number, number] {
  const a = hash32(input);
  const b = hash32(`${input}#salt`);
  return [a / 0x100000000, b / 0x100000000];
}

export function normalise(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Angle between two unit vectors, in radians. Clamped so rounding cannot NaN it. */
export function angleBetween(a: Vec3, b: Vec3): number {
  return Math.acos(Math.min(1, Math.max(-1, dot(a, b))));
}

/**
 * Evenly spread points on a sphere (golden-angle spiral). Index i of n, so the
 * same project list always produces the same zone centres.
 */
export function spiralPoint(i: number, n: number): Vec3 {
  if (n <= 1) return { x: 0, y: 0, z: 1 };
  const y = 1 - (2 * i + 1) / n;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = i * Math.PI * (3 - Math.sqrt(5));
  return { x: Math.cos(theta) * r, y, z: Math.sin(theta) * r };
}

/** Any unit vector perpendicular to v. Stable, and never degenerate. */
export function perpendicular(v: Vec3): Vec3 {
  const away: Vec3 = Math.abs(v.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  const cross: Vec3 = {
    x: v.y * away.z - v.z * away.y,
    y: v.z * away.x - v.x * away.z,
    z: v.x * away.y - v.y * away.x,
  };
  return normalise(cross);
}

/**
 * A point inside the spherical cap of angular radius `radius` around `center`.
 * `seed` decides where: same seed, same point, always. Uniform over the cap
 * area, so dense projects look dense instead of piling up in the middle.
 */
export function pointInCap(center: Vec3, radius: number, seed: string): Vec3 {
  const [u, v] = unitPair(seed);
  const cosMax = Math.cos(Math.min(Math.PI, radius));
  const cosTheta = 1 - u * (1 - cosMax);
  const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
  const phi = v * 2 * Math.PI;

  const c = normalise(center);
  const e1 = perpendicular(c);
  const e2: Vec3 = {
    x: c.y * e1.z - c.z * e1.y,
    y: c.z * e1.x - c.x * e1.z,
    z: c.x * e1.y - c.y * e1.x,
  };

  const a = sinTheta * Math.cos(phi);
  const b = sinTheta * Math.sin(phi);
  return normalise({
    x: c.x * cosTheta + e1.x * a + e2.x * b,
    y: c.y * cosTheta + e1.y * a + e2.y * b,
    z: c.z * cosTheta + e1.z * a + e2.z * b,
  });
}

/** Smallest angle between any two zone centres. Infinity when there is only one. */
export function minCentreSeparation(centers: Vec3[]): number {
  let smallest = Infinity;
  for (let i = 0; i < centers.length; i++) {
    for (let j = i + 1; j < centers.length; j++) {
      smallest = Math.min(smallest, angleBetween(centers[i], centers[j]));
    }
  }
  return smallest;
}

/**
 * Zones for a set of projects. Sorted by name, never by count: a project must
 * not move across the globe because it gained a memory.
 */
export function buildClusters(counts: Map<string, number>): Cluster[] {
  const projects = [...counts.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const centers = projects.map((_, i) => spiralPoint(i, projects.length));

  // One project owns the whole sphere. More than one, and zones stay well apart.
  const ceiling =
    projects.length <= 1
      ? Math.PI
      : Math.min(MAX_ZONE_RADIUS, 0.42 * minCentreSeparation(centers));

  const busiest = Math.max(1, ...projects.map((p) => counts.get(p) ?? 0));

  return projects.map((project, i) => {
    const count = counts.get(project) ?? 0;
    const fill = Math.sqrt(count / busiest);
    const factor = projects.length <= 1 ? 1 : Math.min(1, Math.max(MIN_ZONE_FACTOR, fill));
    return { project, center: centers[i], radius: ceiling * factor, count };
  });
}

export function countByProject(memories: readonly Memory[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of memories) counts.set(m.project, (counts.get(m.project) ?? 0) + 1);
  return counts;
}

/** The whole layout: zones per project, one point per memory. */
export function buildLayout(memories: readonly Memory[]): GlobeLayout {
  const clusters = buildClusters(countByProject(memories));
  const byProject = new Map(clusters.map((c) => [c.project, c]));
  const points: GlobePoint[] = [];

  for (const memory of memories) {
    const cluster = byProject.get(memory.project);
    if (!cluster) continue;
    points.push({
      id: memory.id,
      project: memory.project,
      category: memory.category,
      pos: pointInCap(cluster.center, cluster.radius, memory.id),
    });
  }

  return { clusters, points };
}
