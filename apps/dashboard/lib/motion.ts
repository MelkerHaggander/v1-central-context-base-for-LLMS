/**
 * Motion: every action in the dashboard answers with a short, quiet movement
 * (Filip, 29 Sep: "animera alla actions ... snyggt minimalistiskt").
 *
 * The rules, so the next change keeps them:
 * - Opacity and transform only, plus grid rows for opening and closing
 *   a row. Nothing that makes the page reflow every frame.
 * - Short: 120 ms for a press, 160-240 ms for things appearing, a bit less for
 *   things leaving. One easing curve out, one in. No bounce, no overshoot.
 * - Everything that appears also leaves: panels, menus, the editor, toasts,
 *   rows. Nothing just vanishes.
 * - Reduced motion keeps the fades and drops the movement: --motion is 0, and
 *   every translate and scale in globals.css is multiplied by it.
 *
 * Reduced motion follows the computer until the reader picks one in the
 * account menu. That choice exists because Filip's school Windows has
 * animations switched off by the school, not by him (the globe had the same
 * problem, see GlobeCanvas), and without it he would never see any of this.
 * Stored per browser, applied before first paint by app/layout.tsx.
 */

export const MOTION_KEY = "bc-motion";
export type MotionChoice = "system" | "full" | "reduced";

/** Leave durations in ms. The CSS animations in globals.css match these. */
export const LEAVE_MS = {
  menu: 130,
  panel: 180,
  row: 200,
  modal: 170,
  toast: 180,
} as const;
