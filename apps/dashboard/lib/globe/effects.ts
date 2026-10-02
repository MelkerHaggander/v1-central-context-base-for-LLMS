/**
 * The globe's moments (Filip, 29 Sep: animations that make you go "oooo").
 *
 * - Intro: when a globe opens (sign-in, a space switch) the dots swirl in
 *   from further out and settle on the sphere, project by project, while the
 *   outline draws itself and the sphere spins up and slows to its usual pace.
 * - Landing: a memory saved in the dashboard drops onto its spot from above
 *   the surface, and a ring in its category colour spreads out where it lands.
 * - Ring: a memory checked off or restored sends out the same ring, no drop.
 * - Appear: a dot that shows up while you look (the AI saved it, or Undo)
 *   grows in instead of popping.
 * - Burst: a deleted dot breaks into a few specks that drift out and fade.
 *
 * Still the same rules as the rest (lib/motion.ts): no bounce, colour stays
 * the category's, and with motion reduced the movement goes and only the fades
 * are left.
 *
 * Pure functions. No canvas here, so test/globe-effects.test.ts can pin them.
 */
import { hash32, type Vec3 } from "./sphere";

export function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

export function easeOutCubic(t: number): number {
  const c = clamp01(t);
  return 1 - Math.pow(1 - c, 3);
}

export function easeOutQuart(t: number): number {
  const c = clamp01(t);
  return 1 - Math.pow(1 - c, 4);
}

/* -------------------------------- intro -------------------------------- */

/** Seconds one dot takes to settle. */
export const INTRO_DOT = 1.15;
/** Seconds between one project's dots starting and the next project's. */
export const INTRO_PER_PROJECT = 0.09;
/** Random spread inside a project, seconds, from the id so it is the same every time. */
export const INTRO_JITTER = 0.32;
/** Seconds the outline takes to draw itself. */
export const INTRO_OUTLINE = 1.0;

/** When a dot starts to move, in seconds after the globe opened. */
export function introDelay(id: string, projectIndex: number): number {
  return projectIndex * INTRO_PER_PROJECT + ((hash32(`intro:${id}`) % 1000) / 1000) * INTRO_JITTER;
}

/** Seconds until the last dot of `projects` projects has settled. */
export function introLength(projects: number): number {
  return Math.max(INTRO_OUTLINE, Math.max(0, projects - 1) * INTRO_PER_PROJECT + INTRO_JITTER + INTRO_DOT);
}

/**
 * Where a dot is `elapsed` seconds into the intro: turned back around the
 * vertical axis and pushed out from the centre, both shrinking to nothing as
 * it settles, so the dots spiral in. `still` (reduced motion) keeps the dot
 * at home and only fades it in.
 */
export function introPoint(
  home: Vec3,
  elapsed: number,
  delay: number,
  still = false,
): { pos: Vec3; alpha: number; done: boolean } {
  const p = clamp01((elapsed - delay) / INTRO_DOT);
  const alpha = clamp01(p * 2.4);
  if (still || p >= 1) return { pos: home, alpha, done: p >= 1 };
  const e = easeOutQuart(p);
  const turn = (1 - e) * 1.35;
  const out = 1 + (1 - e) * 0.62;
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  return {
    pos: {
      x: (home.x * c - home.z * s) * out,
      y: home.y * out,
      z: (home.x * s + home.z * c) * out,
    },
    alpha,
    done: false,
  };
}

/** Extra spin (radians per second) that the sphere sheds as the intro ends. */
export function introSpin(elapsed: number, length: number): number {
  const left = 1 - clamp01(elapsed / (length + 0.4));
  return 2.1 * left * left;
}

/* ------------------------------- landing ------------------------------- */

export const LAND_DROP = 0.75;
export const RING = 1.05;

/**
 * A saved dot coming down onto its spot: from 1.75 radii out, twice its size
 * and invisible, to home. After LAND_DROP it is home and the ring takes over.
 */
export function landing(home: Vec3, t: number, still = false): { pos: Vec3; scale: number; alpha: number } {
  const p = clamp01(t / LAND_DROP);
  if (still) return { pos: home, scale: 1, alpha: clamp01(p * 2) };
  const e = easeOutCubic(p);
  const out = 1 + (1 - e) * 0.75;
  return {
    pos: { x: home.x * out, y: home.y * out, z: home.z * out },
    scale: 1 + (1 - e) * 1.2,
    alpha: clamp01(p * 3),
  };
}

/** One ring `t` seconds after it started: how far out, in px, and how strong. */
export function ring(t: number, reach = 30): { radius: number; alpha: number } {
  const p = clamp01(t / RING);
  return { radius: easeOutCubic(p) * reach, alpha: 0.6 * (1 - p) * (1 - p) };
}

/* ----------------------------- appear, burst ----------------------------- */

export const APPEAR = 0.55;
export const BURST = 0.8;
const SPECKS = 7;

export function appear(t: number): { scale: number; alpha: number } {
  const p = clamp01(t / APPEAR);
  return { scale: easeOutCubic(p), alpha: clamp01(p * 1.6) };
}

/** The specks of a deleted dot, as offsets in px from where it was. */
export function burst(id: string, t: number, still = false): Array<{ dx: number; dy: number; r: number; alpha: number }> {
  const p = clamp01(t / BURST);
  if (p >= 1) return [];
  const e = easeOutCubic(p);
  const seed = hash32(`burst:${id}`);
  const out = [];
  for (let i = 0; i < SPECKS; i++) {
    const angle = (i / SPECKS) * Math.PI * 2 + ((seed >>> (i * 3)) % 628) / 100;
    const reach = still ? 0 : (14 + ((seed >>> i) % 12)) * e;
    out.push({ dx: Math.cos(angle) * reach, dy: Math.sin(angle) * reach, r: 1.7 * (1 - p), alpha: 0.85 * (1 - p) });
  }
  return out;
}

/* --------------------------------- link --------------------------------- */

/**
 * The line from a hovered row in the panel to its dot: a soft S from the
 * panel's edge to the dot. Points along it, for drawing it part of the way.
 */
export function linkPath(from: { x: number; y: number }, to: { x: number; y: number }, steps = 28) {
  const bend = Math.max(40, Math.abs(from.x - to.x) * 0.45);
  const c1 = { x: from.x - bend, y: from.y };
  const c2 = { x: to.x + bend * 0.6, y: to.y };
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = (1 - t) ** 3;
    const b = 3 * (1 - t) ** 2 * t;
    const c = 3 * (1 - t) * t * t;
    const d = t ** 3;
    pts.push({
      x: a * from.x + b * c1.x + c * c2.x + d * to.x,
      y: a * from.y + b * c1.y + c * c2.y + d * to.y,
    });
  }
  return pts;
}
