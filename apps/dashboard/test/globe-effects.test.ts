import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INTRO_DOT,
  appear,
  burst,
  introDelay,
  introLength,
  introPoint,
  introSpin,
  landing,
  linkPath,
  ring,
} from "../lib/globe/effects";

const home = { x: 0.6, y: 0.48, z: 0.64 };
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

describe("intro", () => {
  it("starts away from home and ends exactly on it", () => {
    const start = introPoint(home, 0, 0);
    assert.ok(Math.hypot(start.pos.x, start.pos.y, start.pos.z) > 1.5, "starts outside the sphere");
    assert.equal(start.alpha, 0);
    const end = introPoint(home, INTRO_DOT, 0);
    assert.deepEqual(end.pos, home);
    assert.equal(end.alpha, 1);
    assert.equal(end.done, true);
  });

  it("waits for its delay, and the delay is the same every time", () => {
    const d = introDelay("abc", 2);
    assert.equal(d, introDelay("abc", 2));
    assert.ok(d >= 0.18);
    assert.equal(introPoint(home, d - 0.01, d).alpha, 0);
  });

  it("only fades when motion is reduced", () => {
    const mid = introPoint(home, 0.3, 0, true);
    assert.deepEqual(mid.pos, home);
    assert.ok(mid.alpha > 0 && mid.alpha <= 1);
  });

  it("covers every project, and the spin dies out", () => {
    assert.ok(introLength(6) > introLength(1));
    assert.ok(introSpin(0, 2) > 1.5);
    assert.equal(introSpin(10, 2), 0);
  });
});

describe("landing and rings", () => {
  it("drops onto the spot and ends there at normal size", () => {
    const first = landing(home, 0);
    assert.ok(first.scale > 2);
    const last = landing(home, 1);
    assert.ok(near(last.pos.x, home.x) && near(last.pos.y, home.y) && near(last.pos.z, home.z));
    assert.equal(last.scale, 1);
    assert.equal(last.alpha, 1);
  });

  it("a ring spreads and fades to nothing", () => {
    assert.equal(ring(0).radius, 0);
    assert.ok(ring(0.5).radius > 20);
    assert.equal(ring(2).alpha, 0);
  });
});

describe("appear and burst", () => {
  it("a new dot grows in", () => {
    assert.equal(appear(0).scale, 0);
    assert.equal(appear(1).scale, 1);
  });

  it("a deleted dot breaks into specks that are gone at the end", () => {
    const mid = burst("x", 0.3);
    assert.equal(mid.length, 7);
    assert.ok(mid.every((s) => Math.hypot(s.dx, s.dy) > 5));
    assert.deepEqual(burst("x", 1), []);
    assert.ok(burst("x", 0.3, true).every((s) => s.dx === 0 && s.dy === 0), "reduced motion: no drift");
  });
});

describe("link line", () => {
  it("runs from the panel edge to the dot", () => {
    const pts = linkPath({ x: 900, y: 300 }, { x: 420, y: 180 });
    assert.deepEqual(pts[0], { x: 900, y: 300 });
    assert.ok(near(pts[pts.length - 1].x, 420) && near(pts[pts.length - 1].y, 180));
  });
});
