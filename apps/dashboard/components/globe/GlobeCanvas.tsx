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
 * it, and the memory list is the text equivalent of what the sphere shows. The
 * sphere stops spinning when the reader prefers reduced motion.
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
} from "@/lib/globe/camera";
import type { Cluster, GlobePoint } from "@/lib/globe/sphere";
import { useThemeTokens } from "./useThemeTokens";

const TOKENS = [
  "--surface",
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
  onPickProject: (project: string) => void;
  onPickMemory: (id: string) => void;
  onHover: (hover: { id: string; x: number; y: number } | null) => void;
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
  onPickProject,
  onPickMemory,
  onHover,
}: GlobeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tokens = useThemeTokens(TOKENS);

  // Everything the animation loop reads lives in refs, so new props never
  // restart the loop and the sphere never jumps.
  const cam = useRef({ yaw: 0.6, pitch: 0.28, zoom: ZOOM_OVERVIEW });
  const target = useRef<{ yaw: number | null; pitch: number | null; zoom: number }>({
    yaw: null,
    pitch: null,
    zoom: ZOOM_OVERVIEW,
  });
  const drag = useRef<{ active: boolean; x: number; y: number; moved: number }>({
    active: false,
    x: 0,
    y: 0,
    moved: 0,
  });
  const box = useRef({ width: 0, height: 0 });
  const live = useRef({ points, clusters, focusProject, selectedId, highlightCategory, tokens });

  // Written after render, not during it. The next animation frame reads it, so
  // one frame of the previous scene is the worst case and nothing tears.
  useEffect(() => {
    live.current = { points, clusters, focusProject, selectedId, highlightCategory, tokens };
  }, [points, clusters, focusProject, selectedId, highlightCategory, tokens]);

  // Flying to a project, or back out to the whole sphere.
  useEffect(() => {
    if (!focusProject) {
      target.current = { yaw: null, pitch: null, zoom: ZOOM_OVERVIEW };
      return;
    }
    const cluster = clusters.find((c) => c.project === focusProject);
    if (!cluster) return;
    const facing = faceTarget(cluster.center);
    target.current = { yaw: facing.yaw, pitch: facing.pitch, zoom: ZOOM_PROJECT };
  }, [focusProject, clusters]);

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

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      box.current = { width: rect.width, height: rect.height };
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

      const t = target.current;
      if (t.yaw !== null && t.pitch !== null) {
        cam.current.yaw = approachAngle(cam.current.yaw, t.yaw, 5, dt);
        cam.current.pitch = approach(cam.current.pitch, t.pitch, 5, dt);
      } else if (!drag.current.active && !reduceMotion) {
        cam.current.yaw += SPIN_PER_SECOND * dt;
      }
      cam.current.zoom = approach(cam.current.zoom, t.zoom, 5, dt);

      draw(ctx, cameraNow(), live.current);
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [cameraNow]);

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
      target.current = { yaw: null, pitch: null, zoom: target.current.zoom };
      cam.current.yaw -= dx * 0.006;
      cam.current.pitch = clampPitch(cam.current.pitch - dy * 0.006);
      onHover(null);
      return;
    }

    const hit = hitTest(points, cameraNow(), p.x, p.y, HIT_TOLERANCE);
    onHover(hit ? { id: hit.id, x: p.x, y: p.y } : null);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const wasDrag = drag.current.moved > 6;
    drag.current.active = false;
    if (wasDrag) return;

    const p = localPoint(event);
    const hit = hitTest(points, cameraNow(), p.x, p.y, HIT_TOLERANCE);
    if (!hit) return;
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
  points: readonly GlobePoint[];
  clusters: readonly Cluster[];
  focusProject: string | null;
  selectedId: string | null;
  highlightCategory: string | null;
  tokens: Record<string, string>;
};

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

  // A soft volume hint plus one hairline at the limb. That is all the chrome the
  // sphere gets: the dots are the data and nothing else should compete.
  ctx.globalAlpha = chrome;
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

  ctx.lineWidth = 1;
  ctx.strokeStyle = limb;
  ctx.beginPath();
  ctx.arc(camera.centerX, camera.centerY, silhouette, 0, Math.PI * 2);
  ctx.stroke();

  drawWireframe(ctx, camera, wire);
  ctx.globalAlpha = 1;

  // Back to front, so nearer dots cover further ones.
  const drawn = scene.points
    .map((point) => ({ point, p: project(point.pos, camera) }))
    .sort((a, b) => b.p.depth - a.p.depth);

  for (const { point, p } of drawn) {
    const dimmedByProject = scene.focusProject !== null && point.project !== scene.focusProject;
    const dimmedByCategory =
      scene.highlightCategory !== null && point.category !== scene.highlightCategory;
    const selected = point.id === scene.selectedId;

    let alpha = p.front ? 1 : 0.16;
    if (dimmedByProject) alpha *= 0.1;
    if (dimmedByCategory) alpha *= 0.14;
    if (selected) alpha = 1;
    if (alpha < 0.02) continue;

    const radius = (selected ? DOT_SELECTED : DOT_BASE) * p.perspective;
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

    if (selected) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius + 5, 0, Math.PI * 2);
      ctx.stroke();
    }
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
