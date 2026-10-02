"use client";

/**
 * The globe.
 *
 * One dot per memory. Position is the project, colour is the category. It is
 * real 3D: unit vectors on a sphere, a rotation matrix, a perspective divide and
 * a back-to-front depth sort, drawn on a 2D canvas. No WebGL and no library, on
 * purpose, because three.js would put a dependency in a lockfile that apps/api
 * also builds from on Vercel, to draw a few hundred dots that canvas handles at
 * 60fps.
 *
 * The maths is in lib/globe/. This file is the loop, the input and the paint.
 *
 * Accessibility: a canvas cannot be tabbed into, so it is never the only way to
 * reach anything. Every project and every category is also a real button beside
 * it, and the memory list is the text equivalent of what the sphere shows.
 *
 * Motion: the sphere always spins slowly, also when the system asks for
 * reduced motion (Filip, 28 Sep: his school Windows has animations off, so the
 * globe stood still and the gather jumped). The pause button is the way to
 * stop it, as WCAG 2.2.2 asks for moving content, and it is remembered. The
 * new-memory ring still stops breathing under reduced motion.
 *
 * Moments (29 Sep, lib/globe/effects.ts): the dots swirl in when a globe
 * opens, a saved memory lands with a ring, a checked-off one rings, a deleted
 * one breaks into specks, a new one grows in, and hovering a row in the panel
 * draws a line from the row to its dot. These follow the Motion setting
 * (lib/motion.ts): reduced keeps the fades and drops the movement.
 */

import { useCallback, useEffect, useRef } from "react";
import {
  type Camera,
  approach,
  approachAngle,
  clampPitch,
  faceTarget,
  hitTest,
  project,
  shortestTurn,
  unrotate,
} from "@/lib/globe/camera";
import {
  BURST,
  LAND_DROP,
  RING,
  appear,
  burst,
  clamp01,
  easeOutCubic,
  introDelay,
  introLength,
  introPoint,
  introSpin,
  landing,
  linkPath,
  ring,
} from "@/lib/globe/effects";
import { gatherTargets, gatheredPositions } from "@/lib/globe/gather";
import type { Cluster, GlobePoint, Vec3 } from "@/lib/globe/sphere";
import { motionReduced } from "../useMotion";
import { useThemeTokens } from "./useThemeTokens";

const TOKENS = [
  "--surface",
  "--bg",
  "--ink-2",
  "--globe-wire",
  "--globe-limb",
  "--globe-halo",
  "--ink",
  "--cat-fact",
  "--cat-decision",
  "--cat-goal",
  "--cat-deadline",
  "--cat-preference",
  "--cat-lesson",
] as const;

const DISTANCE = 2.6;
/** Straight in front of the camera, in view space. */
const VIEW_FRONT = { x: 0, y: 0, z: 1 };
const SPIN_PER_SECOND = 0.055;
const ZOOM_OVERVIEW = 1;
const ZOOM_PROJECT = 1.5;
const DOT_BASE = 4.4;
const DOT_SELECTED = 7;
const HIT_TOLERANCE = 20;
/** Meridians and parallels. Few and faint: they read the rotation, nothing else.
 *  More than this and the lines converging at the poles pull the eye off the data. */
const MERIDIANS = 4;
const PARALLELS = 3;
/**
 * How much of the shorter side the sphere takes. Deliberately not the whole box:
 * the breadcrumb sits above it and the legend below, and perspective pushes the
 * near half about 8% past radiusPx, so the silhouette needs headroom on all four
 * sides.
 */
const FIT = 0.74;
/** On a tall narrow screen the width is the constraint, so the sphere may take more of it. */
const FIT_PORTRAIT = 0.92;
/** Zoom at which the wireframe and the limb have fully faded out. */
const CHROME_GONE_AT = 1.3;

export type GlobeCanvasProps = {
  points: readonly GlobePoint[];
  clusters: readonly Cluster[];
  /** Zoomed into this project, or null for the whole sphere. */
  focusProject: string | null;
  /** Highlighted memory, or null. */
  selectedId: string | null;
  /** Dots of this category stay lit, the rest recede. null means all of them. */
  highlightCategory: string | null;
  /** v1.2: only these dots stay lit (a panel of new rows, duplicates, a search). null means all. */
  highlightIds?: ReadonlySet<string> | null;
  /** v1.2: created in the last 24 hours. Drawn with a ring, never a new colour. */
  newIds?: ReadonlySet<string>;
  /** Melker's point 4: stop the spin. The only thing that does; dragging and fly-to still work. */
  paused?: boolean;
  /**
   * Turn the sphere so these dots face the reader (a category, today's new
   * rows, a duplicate pair). Only when no project is focused. A hover never
   * passes this, so moving the mouse down a list does not spin the globe.
   */
  flyToIds?: ReadonlySet<string> | null;
  /**
   * Legend click: every dot of this category flies into one group in front of
   * the reader, and flies back when it goes null. The group is held in front
   * of the camera, so the sphere keeps spinning behind it; the other
   * categories all but disappear.
   */
  gatherCategory?: string | null;
  onPickProject: (project: string) => void;
  onPickMemory: (id: string) => void;
  onHover: (hover: { id: string; x: number; y: number } | null) => void;
  /** Saved (land) or checked off / restored (ring). `n` replays it for the same id. */
  ping?: { id: string; n: number; kind: "land" | "ring" } | null;
  /**
   * The row hovered in the panel and its vertical middle on screen. A ref,
   * not a prop value, so moving down a list never re-renders the page; the
   * loop reads it every frame.
   */
  linkRef?: { current: { id: string; y: number } | null };
};

/** A dot as drawn this frame: where it is, plus what a moment does to its size and strength. */
type DrawnPoint = GlobePoint & { fxScale?: number; fxAlpha?: number };

type Moments = {
  /** 0 -> 1: the outline drawing itself when the globe opens. */
  outline: number;
  /** 0 -> 1: wireframe, halo and labels fading in after it. */
  chrome: number;
  rings: Array<{ pos: Vec3; category: string; t: number; reach: number }>;
  bursts: Array<{ id: string; pos: Vec3; category: string; t: number }>;
  link: { id: string; y: number; t: number } | null;
  still: boolean;
};

function colourFor(category: string, tokens: Record<string, string>, fallback: string): string {
  return tokens[`--cat-${category}`] || fallback;
}

export function GlobeCanvas({
  points,
  clusters,
  focusProject,
  selectedId,
  highlightCategory,
  highlightIds = null,
  newIds = EMPTY,
  paused = false,
  flyToIds = null,
  gatherCategory = null,
  onPickProject,
  onPickMemory,
  onHover,
  ping = null,
  linkRef,
}: GlobeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tokens = useThemeTokens(TOKENS);

  // Everything the animation loop reads lives in refs, so new props never
  // restart the loop and the sphere never jumps.
  const cam = useRef({ yaw: 0.6, pitch: 0.28, zoom: ZOOM_OVERVIEW });
  // hold: keep facing the target (a focused project). Without it the camera
  // turns there once and then hands back to the spin.
  const target = useRef<{ yaw: number | null; pitch: number | null; zoom: number; hold: boolean }>({
    yaw: null,
    pitch: null,
    zoom: ZOOM_OVERVIEW,
    hold: false,
  });
  const drag = useRef<{ active: boolean; x: number; y: number; moved: number }>({
    active: false,
    x: 0,
    y: 0,
    moved: 0,
  });
  const box = useRef({ width: 0, height: 0, top: 0 });
  const live = useRef<Scene>({
    points,
    clusters,
    focusProject,
    selectedId,
    highlightCategory,
    highlightIds,
    newIds,
    tokens,
    time: 0,
    backAlpha: 0.16,
  });
  const pausedRef = useRef(paused);
  // The gather animation. t runs 0 -> 1 in, 1 -> 0 out; targets stay until it is home.
  // `view` is where each dot of the group sits relative to the camera, fixed
  // for the whole gather; `targets` is that turned back onto the sphere for
  // the current camera, every frame.
  const gather = useRef<{
    category: string | null;
    view: Map<string, Vec3>;
    targets: Map<string, Vec3>;
    t: number;
    goal: 0 | 1;
  }>({ category: null, view: new Map(), targets: new Map(), t: 0, goal: 0 });
  // What was drawn last frame, so a click hits the dot where it is, not where it lives.
  const shown = useRef<readonly GlobePoint[]>(points);

  // The moments. All read and written by the loop and by effects, never in render.
  const intro = useRef<{ start: number | null; order: Map<string, number>; length: number }>({
    start: null,
    order: new Map(clusters.map((c, i) => [c.project, i])),
    length: introLength(clusters.length),
  });
  const pings = useRef<Array<{ id: string; kind: "land" | "ring"; start: number | null; asked: number }>>([]);
  const appeared = useRef(new Map<string, number>());
  const bursts = useRef<Array<{ id: string; pos: Vec3; category: string; start: number }>>([]);
  const link = useRef<{ id: string | null; start: number }>({ id: null, start: 0 });

  // Written after render, not during it. The next animation frame reads it, so
  // one frame of the previous scene is the worst case and nothing tears.
  useEffect(() => {
    // What came and went since the last scene: new dots grow in, gone ones burst.
    const before = live.current.points;
    if (before !== points) {
      const now = performance.now();
      const was = new Map(before.map((p) => [p.id, p]));
      const is = new Set(points.map((p) => p.id));
      for (const p of points) if (!was.has(p.id)) appeared.current.set(p.id, now);
      let gone = 0;
      for (const [id, p] of was) {
        if (is.has(id) || gone++ > 40) continue;
        bursts.current.push({ id, pos: p.pos, category: p.category, start: now });
      }
    }
    live.current = {
      points,
      clusters,
      focusProject,
      selectedId,
      highlightCategory,
      highlightIds,
      newIds,
      tokens,
      time: live.current.time,
      backAlpha: isLightSurface(tokens["--surface"]) ? 0.42 : 0.28,
    };
  }, [points, clusters, focusProject, selectedId, highlightCategory, highlightIds, newIds, tokens]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    if (!ping) return;
    pings.current = pings.current.filter((p) => p.id !== ping.id);
    pings.current.push({ id: ping.id, kind: ping.kind, start: null, asked: performance.now() });
  }, [ping]);

  // Flying to a project, or back out to the whole sphere.
  useEffect(() => {
    if (!focusProject) {
      target.current = { yaw: null, pitch: null, zoom: ZOOM_OVERVIEW, hold: false };
      return;
    }
    const cluster = clusters.find((c) => c.project === focusProject);
    if (!cluster) return;
    const facing = faceTarget(cluster.center);
    // The one place the spin waits: a project being read would turn away.
    target.current = { yaw: facing.yaw, pitch: facing.pitch, zoom: ZOOM_PROJECT, hold: true };
  }, [focusProject, clusters]);

  useEffect(() => {
    if (focusProject || !flyToIds || flyToIds.size === 0) return;
    let x = 0;
    let y = 0;
    let z = 0;
    for (const point of points) {
      if (!flyToIds.has(point.id)) continue;
      x += point.pos.x;
      y += point.pos.y;
      z += point.pos.z;
    }
    const length = Math.hypot(x, y, z);
    // Dots spread all round the sphere have no side to face. Leave the camera.
    if (length < 0.15 * flyToIds.size) return;
    const facing = faceTarget({ x: x / length, y: y / length, z: z / length });
    target.current = { yaw: facing.yaw, pitch: facing.pitch, zoom: ZOOM_OVERVIEW, hold: false };
    // points is read, not watched: a refetch must not yank the camera back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyToIds, focusProject]);

  useEffect(() => {
    const g = gather.current;
    if (gatherCategory) {
      // Laid out once around the camera's own front, (0, 0, 1) in view space.
      g.category = gatherCategory;
      g.view = gatherTargets(points, gatherCategory, VIEW_FRONT);
      g.goal = 1;
      target.current = { yaw: null, pitch: null, zoom: ZOOM_OVERVIEW, hold: false };
    } else {
      g.goal = 0;
    }
  }, [gatherCategory, points]);

  const cameraNow = useCallback((): Camera => {
    const { width, height } = box.current;
    const fit = height > width * 1.25 ? FIT_PORTRAIT : FIT;
    return {
      yaw: cam.current.yaw,
      pitch: cam.current.pitch,
      zoom: cam.current.zoom,
      distance: DISTANCE,
      radiusPx: (Math.min(width, height) / 2) * fit,
      centerX: width / 2,
      centerY: height / 2,
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Only the new-memory ring listens to this now; spin and gather always move.
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // The moments follow the Motion setting, which can change while the globe is open.
    let still = motionReduced();
    const onMotion = () => {
      still = motionReduced();
    };
    window.addEventListener("bc-motion", onMotion);
    if (!still) cam.current.zoom = 0.84;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      box.current = { width: rect.width, height: rect.height, top: rect.top };
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let raf = 0;
    let previous = performance.now();

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - previous) / 1000);
      previous = now;
      const intr = intro.current;
      if (intr.start === null) intr.start = now;
      const elapsed = (now - intr.start) / 1000;
      const introOn = elapsed < intr.length + 0.5;

      const t = target.current;
      if (t.yaw !== null && t.pitch !== null) {
        cam.current.yaw = approachAngle(cam.current.yaw, t.yaw, 5, dt);
        cam.current.pitch = approach(cam.current.pitch, t.pitch, 5, dt);
        // A fly-to (new rows, a checklist) turns there once, then the spin
        // takes over again. Only a focused project holds the camera.
        const arrived =
          Math.abs(shortestTurn(cam.current.yaw, t.yaw)) < 0.01 && Math.abs(cam.current.pitch - t.pitch) < 0.01;
        if (arrived && !t.hold) target.current = { yaw: null, pitch: null, zoom: t.zoom, hold: false };
      } else if (!drag.current.active && !pausedRef.current) {
        // As a globe opens it spins up and slows to its usual pace.
        const boost = introOn && !still ? introSpin(elapsed, intr.length) : 0;
        cam.current.yaw += (SPIN_PER_SECOND + boost) * dt;
      }
      cam.current.zoom = approach(cam.current.zoom, t.zoom, 5, dt);

      // About 0.7 s each way, always: the pull-in is the point of the click.
      const g = gather.current;
      if (g.t !== g.goal) {
        const step = dt / 0.7;
        g.t = g.goal === 1 ? Math.min(1, g.t + step) : Math.max(0, g.t - step);
        if (g.t === 0) {
          g.category = null;
          g.view = new Map();
          g.targets = new Map();
        }
      }
      // The group follows the camera, so it stays in front while the sphere spins.
      if (g.category) {
        const next = new Map<string, Vec3>();
        for (const [id, v] of g.view) next.set(id, unrotate(v, cam.current.yaw, cam.current.pitch));
        g.targets = next;
      }

      const scene = live.current;
      const gathered = gatheredPositions(scene.points, g.targets, g.t);
      const moments: Moments = {
        outline: introOn ? easeOutCubic(elapsed / 1.0) : 1,
        chrome: introOn ? clamp01((elapsed - 0.25) / 0.9) : 1,
        rings: [],
        bursts: [],
        link: null,
        still,
      };

      // The dots through the moments: intro, landing, growing in.
      const byId = new Map<string, number>();
      const drawnPoints: DrawnPoint[] = gathered.map((point, i) => {
        byId.set(point.id, i);
        let pos = point.pos;
        let fxScale = 1;
        let fxAlpha = 1;
        if (introOn) {
          const order = intr.order.get(point.project) ?? intr.order.size;
          const at = introPoint(pos, elapsed, introDelay(point.id, order), still);
          pos = at.pos;
          fxAlpha *= at.alpha;
        }
        const born = appeared.current.get(point.id);
        if (born !== undefined) {
          const a = appear((now - born) / 1000);
          fxScale *= still ? 1 : a.scale;
          fxAlpha *= a.alpha;
          if (a.scale >= 1 && a.alpha >= 1) appeared.current.delete(point.id);
        }
        return fxScale === 1 && fxAlpha === 1 && pos === point.pos ? point : { ...point, pos, fxScale, fxAlpha };
      });

      // Saved: drop onto the spot, then ring. Checked off or restored: ring.
      pings.current = pings.current.filter((p) => {
        const i = byId.get(p.id);
        if (i === undefined) return now - p.asked < 6000; // not in the list yet, wait a little
        if (p.start === null) p.start = now + (p.kind === "land" ? 280 : 120);
        const t = (now - p.start) / 1000;
        const dot = drawnPoints[i];
        if (p.kind === "land") {
          if (t < 0) {
            drawnPoints[i] = { ...dot, fxAlpha: 0 };
            return true;
          }
          if (t < LAND_DROP) {
            const l = landing(dot.pos, t, still);
            drawnPoints[i] = { ...dot, pos: l.pos, fxScale: (dot.fxScale ?? 1) * l.scale, fxAlpha: (dot.fxAlpha ?? 1) * l.alpha };
          }
        }
        const r = p.kind === "land" ? t - LAND_DROP : t;
        if (r >= 0) {
          moments.rings.push({ pos: dot.pos, category: dot.category, t: r, reach: 34 });
          moments.rings.push({ pos: dot.pos, category: dot.category, t: r - 0.2, reach: 54 });
        }
        return r < RING + 0.4;
      });

      bursts.current = bursts.current.filter((b) => {
        const t = (now - b.start) / 1000;
        if (t > BURST) return false;
        moments.bursts.push({ id: b.id, pos: b.pos, category: b.category, t });
        return true;
      });

      // The row under the pointer in the panel, and how far its line is drawn.
      const hovered = linkRef?.current ?? null;
      if ((hovered?.id ?? null) !== link.current.id) link.current = { id: hovered?.id ?? null, start: now };
      if (hovered && box.current.width >= 360 && window.innerWidth >= 640) {
        moments.link = { id: hovered.id, y: hovered.y - box.current.top, t: (now - link.current.start) / 1000 };
      }

      shown.current = drawnPoints;
      scene.time = reduceMotion ? 0 : now / 1000;
      draw(ctx, cameraNow(), {
        ...scene,
        points: drawnPoints,
        gathering: g.t > 0,
        moments,
      });
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("bc-motion", onMotion);
    };
  }, [cameraNow, linkRef]);

  const localPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const p = localPoint(event);
    drag.current = { active: true, x: p.x, y: p.y, moved: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const p = localPoint(event);

    if (drag.current.active) {
      const dx = p.x - drag.current.x;
      const dy = p.y - drag.current.y;
      drag.current.moved += Math.abs(dx) + Math.abs(dy);
      drag.current.x = p.x;
      drag.current.y = p.y;

      // Dragging takes over from the fly-to, so the reader is never fighting it.
      target.current = { yaw: null, pitch: null, zoom: target.current.zoom, hold: false };
      cam.current.yaw -= dx * 0.006;
      cam.current.pitch = clampPitch(cam.current.pitch - dy * 0.006);
      onHover(null);
      return;
    }

    const hit = hitTest(shown.current, cameraNow(), p.x, p.y, HIT_TOLERANCE);
    onHover(hit ? { id: hit.id, x: p.x, y: p.y } : null);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const wasDrag = drag.current.moved > 6;
    drag.current.active = false;
    if (wasDrag) return;

    const p = localPoint(event);
    const hit = hitTest(shown.current, cameraNow(), p.x, p.y, HIT_TOLERANCE);
    if (!hit) return;
    // In a gathered group a click opens that memory; position no longer means project.
    if (gather.current.category && hit.category === gather.current.category) {
      onPickMemory(hit.id);
      return;
    }
    // One level per click: the whole sphere goes to a project, a project goes to
    // a memory.
    if (!focusProject || hit.project !== focusProject) onPickProject(hit.project);
    else onPickMemory(hit.id);
  };

  const summary =
    clusters.length === 0
      ? "Globe of memories. Nothing saved yet."
      : `Globe of ${points.length} memories in ${clusters.length} projects. Each dot is one memory, grouped by project and coloured by category. The list beside it holds the same information as text.`;

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={summary}
      className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => {
        drag.current.active = false;
        onHover(null);
      }}
    />
  );
}

type Scene = {
  points: readonly DrawnPoint[];
  clusters: readonly Cluster[];
  focusProject: string | null;
  selectedId: string | null;
  highlightCategory: string | null;
  highlightIds: ReadonlySet<string> | null;
  newIds: ReadonlySet<string>;
  tokens: Record<string, string>;
  /** Seconds, for the new-memory pulse. 0 when motion is reduced. */
  time: number;
  /** Far-side dots. Light mode needs more: a faint colour on white vanishes. */
  backAlpha: number;
  /** A category is gathered or on its way; project labels would point at nothing. */
  gathering?: boolean;
  moments?: Moments;
};

const EMPTY: ReadonlySet<string> = new Set();

/** True for a light surface token, so far-side dots can be drawn stronger there. */
function isLightSurface(hex: string | undefined): boolean {
  // The CSS pipeline may shorten #ffffff to #fff, so take both forms.
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex ?? "").trim());
  if (!m) return false;
  const full = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const n = parseInt(full, 16);
  const luminance = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return luminance > 0.6;
}

function draw(ctx: CanvasRenderingContext2D, camera: Camera, scene: Scene) {
  const { width, height } = { width: camera.centerX * 2, height: camera.centerY * 2 };
  ctx.clearRect(0, 0, width, height);
  if (width < 2 || height < 2) return;

  const surface = scene.tokens["--surface"] || "#131517";
  const wire = scene.tokens["--globe-wire"] || "rgba(255,255,255,0.08)";
  const limb = scene.tokens["--globe-limb"] || "rgba(255,255,255,0.12)";
  const halo = scene.tokens["--globe-halo"] || "rgba(255,255,255,0.05)";
  const ink = scene.tokens["--ink"] || "#f1f2f3";

  const silhouette = camera.radiusPx * camera.zoom;

  // The wireframe and the limb fade out as you zoom into a project. Once the
  // sphere is bigger than the box its outline would be a circle cut off by the
  // edges, which reads as a rendering fault rather than as flying in.
  const chrome = Math.max(0, Math.min(1, (CHROME_GONE_AT - camera.zoom) / (CHROME_GONE_AT - 1)));
  const m = scene.moments;
  const fadeIn = m ? m.chrome : 1;

  // A soft volume hint plus one hairline at the limb. That is all the chrome the
  // sphere gets: the dots are the data and nothing else should compete.
  ctx.globalAlpha = chrome * fadeIn;
  const glow = ctx.createRadialGradient(
    camera.centerX - silhouette * 0.25,
    camera.centerY - silhouette * 0.3,
    silhouette * 0.1,
    camera.centerX,
    camera.centerY,
    silhouette,
  );
  glow.addColorStop(0, halo);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(camera.centerX, camera.centerY, silhouette, 0, Math.PI * 2);
  ctx.fill();

  // The outline draws itself from the top when a globe opens (fades in when motion is reduced).
  const sweep = m ? m.outline : 1;
  const drawing = m !== undefined && !m.still && sweep < 1;
  ctx.globalAlpha = chrome * (m?.still ? sweep : 1);
  ctx.lineWidth = 1;
  ctx.strokeStyle = limb;
  ctx.beginPath();
  if (drawing) ctx.arc(camera.centerX, camera.centerY, silhouette, -Math.PI / 2, -Math.PI / 2 + sweep * Math.PI * 2);
  else ctx.arc(camera.centerX, camera.centerY, silhouette, 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalAlpha = chrome * fadeIn;
  drawWireframe(ctx, camera, wire);
  ctx.globalAlpha = 1;

  // Back to front, so nearer dots cover further ones.
  const drawn = scene.points
    .map((point) => ({ point, p: project(point.pos, camera) }))
    .sort((a, b) => b.p.depth - a.p.depth);

  for (const { point, p } of drawn) {
    const inFocus = scene.focusProject !== null && point.project === scene.focusProject;
    const dimmedByProject = scene.focusProject !== null && !inFocus;
    const dimmedByCategory =
      scene.highlightCategory !== null && point.category !== scene.highlightCategory;
    const dimmedById = scene.highlightIds !== null && !scene.highlightIds.has(point.id);
    const lit =
      (scene.highlightIds !== null && !dimmedById) ||
      (scene.highlightCategory !== null && !dimmedByCategory);
    const selected = point.id === scene.selectedId;

    // Melker's point 5: every dot of the chosen project must read as lit, also
    // the ones on the far side, which v1.1 left at 16% and people missed.
    let alpha = p.front ? 1 : inFocus || lit ? 0.55 : scene.backAlpha;
    alpha *= point.fxAlpha ?? 1;
    if (dimmedByProject) alpha *= 0.1;
    // While a category is gathered the others all but vanish, so the group
    // is only that colour.
    if (dimmedByCategory) alpha *= scene.gathering ? 0.04 : 0.14;
    if (dimmedById) alpha *= 0.12;
    if (selected) alpha = point.fxAlpha ?? 1;
    if (alpha < 0.02) continue;

    const boost = inFocus || lit ? 1.18 : 1;
    const radius = (selected ? DOT_SELECTED : DOT_BASE * boost) * p.perspective * (point.fxScale ?? 1);
    if (radius < 0.2) continue;
    const colour = colourFor(point.category, scene.tokens, ink);

    ctx.globalAlpha = alpha;

    // A 2px ring in the surface colour, so overlapping dots stay countable.
    // Never a stroke in the data colour: that would add weight that is not data.
    if (p.front) {
      ctx.fillStyle = surface;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius + 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();

    // New in the last 24 hours: a thin ink ring that breathes. Colour stays category.
    if (scene.newIds.has(point.id) && p.front && !selected) {
      const pulse = scene.time === 0 ? 1 : 0.55 + 0.45 * Math.sin(scene.time * 2.6);
      ctx.globalAlpha = alpha * pulse;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius + 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (selected) {
      ctx.globalAlpha = point.fxAlpha ?? 1;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius + 5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 1;

  if (m) drawMoments(ctx, camera, scene, m);
  drawLabels(ctx, camera, scene, fadeIn);
}

/** Rings, specks and the row-to-dot line, on top of the dots. */
function drawMoments(ctx: CanvasRenderingContext2D, camera: Camera, scene: Scene, m: Moments) {
  const ink = scene.tokens["--ink"] || "#f1f2f3";

  for (const r of m.rings) {
    if (r.t < 0) continue;
    const p = project(r.pos, camera);
    const { radius, alpha } = ring(r.t, r.reach * (m.still ? 0.6 : 1));
    if (alpha < 0.01) continue;
    const base = DOT_BASE * p.perspective;
    ctx.globalAlpha = alpha * (p.front ? 1 : 0.35);
    ctx.strokeStyle = colourFor(r.category, scene.tokens, ink);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, base + 3 + radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  for (const b of m.bursts) {
    const p = project(b.pos, camera);
    const colour = colourFor(b.category, scene.tokens, ink);
    const fade = p.front ? 1 : 0.3;
    // The dot itself shrinks away while its specks drift out.
    const left = 1 - easeOutCubic(b.t / 0.35);
    if (left > 0) {
      ctx.globalAlpha = left * fade;
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(p.x, p.y, DOT_BASE * p.perspective * left, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = colour;
    for (const s of burst(b.id, b.t, m.still)) {
      if (s.alpha < 0.01 || s.r < 0.1) continue;
      ctx.globalAlpha = s.alpha * fade;
      ctx.beginPath();
      ctx.arc(p.x + s.dx * p.perspective, p.y + s.dy * p.perspective, s.r * p.perspective, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (m.link) {
    const point = scene.points.find((d) => d.id === m.link!.id);
    if (point) {
      const p = project(point.pos, camera);
      const from = { x: camera.centerX * 2 + 1, y: m.link.y };
      const pts = linkPath(from, { x: p.x, y: p.y });
      const e = m.still ? 1 : easeOutCubic(m.link.t / 0.38);
      const upto = e * (pts.length - 1);
      const whole = Math.floor(upto);
      ctx.globalAlpha = (p.front ? 0.55 : 0.28) * Math.min(1, e * 2);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i <= whole; i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (whole < pts.length - 1) {
        const f = upto - whole;
        const a = pts[whole];
        const b = pts[whole + 1];
        ctx.lineTo(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
      }
      ctx.stroke();
      // Where the line starts at the panel, and a ring round the dot once it arrives.
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.arc(from.x - 1, from.y, 2, 0, Math.PI * 2);
      ctx.fill();
      if (e >= 0.98) {
        const breathe = m.still ? 1 : 0.75 + 0.25 * Math.sin(m.link.t * 4);
        ctx.globalAlpha = (p.front ? 0.9 : 0.45) * breathe;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, DOT_BASE * p.perspective + 6, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * v1.2: the project's name at the middle of its zone, so a patch of dots means
 * something without hovering. Only on the near side, only in the overview
 * (zoomed into one project the breadcrumb already names it), and with a halo
 * in the page colour so the text stays readable over dots and wireframe.
 */
function drawLabels(ctx: CanvasRenderingContext2D, camera: Camera, scene: Scene, fadeIn = 1) {
  if (scene.focusProject !== null || camera.zoom > 1.15 || scene.gathering || fadeIn <= 0.02) return;
  const bg = scene.tokens["--bg"] || "#131517";
  const ink = scene.tokens["--ink-2"] || scene.tokens["--ink"] || "#b4b7ba";
  const quiet = scene.highlightIds !== null || scene.highlightCategory !== null;

  ctx.font = '600 12px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";

  for (const cluster of scene.clusters) {
    const p = project(cluster.center, camera);
    if (!p.front) continue;
    // Fade towards the edge of the sphere, where text would be squashed.
    const dx = (p.x - camera.centerX) / (camera.radiusPx * camera.zoom);
    const dy = (p.y - camera.centerY) / (camera.radiusPx * camera.zoom);
    const edge = Math.hypot(dx, dy);
    const fade = Math.max(0, Math.min(1, (0.97 - edge) / 0.2));
    if (fade <= 0.02) continue;

    const name = cluster.project.length > 26 ? `${cluster.project.slice(0, 25)}…` : cluster.project;
    ctx.globalAlpha = fade * fadeIn * (quiet ? 0.45 : 0.92);
    ctx.lineWidth = 4;
    ctx.strokeStyle = bg;
    ctx.strokeText(name, p.x, p.y);
    ctx.fillStyle = ink;
    ctx.fillText(name, p.x, p.y);
  }
  ctx.globalAlpha = 1;
}

/** Solid hairlines only. A dashed grid reads as a threshold, and this is not one. */
function drawWireframe(ctx: CanvasRenderingContext2D, camera: Camera, colour: string) {
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1;

  const steps = 72;

  for (let m = 0; m < MERIDIANS; m++) {
    const lon = (m / MERIDIANS) * Math.PI;
    strokeCircle(ctx, camera, steps, (t) => ({
      x: Math.sin(t) * Math.cos(lon),
      y: Math.cos(t),
      z: Math.sin(t) * Math.sin(lon),
    }));
  }

  for (let p = 1; p <= PARALLELS; p++) {
    const lat = (p / (PARALLELS + 1)) * Math.PI - Math.PI / 2;
    const r = Math.cos(lat);
    const y = Math.sin(lat);
    strokeCircle(ctx, camera, steps, (t) => ({
      x: Math.cos(t) * r,
      y,
      z: Math.sin(t) * r,
    }));
  }
}

function strokeCircle(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  steps: number,
  at: (t: number) => { x: number; y: number; z: number },
) {
  // Only the near half is drawn. Both halves at once turns the sphere into a
  // ball of yarn and hides the dots.
  let open = false;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const projected = project(at(t), camera);
    if (!projected.front) {
      open = false;
      continue;
    }
    if (open) ctx.lineTo(projected.x, projected.y);
    else {
      ctx.moveTo(projected.x, projected.y);
      open = true;
    }
  }
  ctx.stroke();
}
