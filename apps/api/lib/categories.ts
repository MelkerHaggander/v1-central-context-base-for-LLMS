/**
 * UI presentation for the six locked categories. The wire values stay lowercase
 * English exactly as docs/contracts.md defines them; this file only decides how
 * they are labelled and coloured.
 *
 * Colour choice is not taste. The six hues were picked with the data-viz
 * validator: every neighbouring pair in DISPLAY_ORDER clears colour-vision
 * separation (worst adjacent CVD deltaE 11.4 light / 13.2 dark, target >= 8) and
 * the normal-vision floor (18.6 / 19.3, floor 15) against both surfaces.
 * Re-run the validator before changing a hue or the order.
 *
 * v1.2: the light steps are one notch darker than v1.1, because goal and
 * deadline sat at 2.1:1 and 2.6:1 on white and the globe was hard to read in
 * light mode. Re-checked 29 Sep for the Off-White + Charcoal and Black +
 * Warm White themes: all six light steps clear 4:1 on the page and panel
 * (#fafaf8, #ffffff), all six dark steps 4.5:1 (#0e0e0d, #171716), and the
 * separation figures above hold on all four surfaces.
 * Colour is still never the only channel: every dot, chip and legend row also
 * carries its label in text. Keep that rule if you restyle.
 */
import { CATEGORIES, type Category } from "./types";

/** Fixed order. Never sort by count: colour follows the category, not its rank. */
export const DISPLAY_ORDER: readonly Category[] = [
  "fact",
  "decision",
  "goal",
  "deadline",
  "preference",
  "lesson",
] as const;

export const CATEGORY_LABEL: Record<Category, string> = {
  fact: "Fact",
  decision: "Decision",
  goal: "Goal",
  deadline: "Deadline",
  preference: "Preference",
  lesson: "Lesson",
};

/** One short line per category, shown in the editor so the choice is informed. */
export const CATEGORY_HINT: Record<Category, string> = {
  fact: "Something confirmed to be true.",
  decision: "A choice that has been made.",
  goal: "Something being worked towards.",
  deadline: "A date or time that has to hold.",
  preference: "How you want things done.",
  lesson: "A lesson that should steer future work. Written by the model.",
};

/** Light and dark steps of the same six hues, validated per surface. */
export const CATEGORY_HEX: Record<Category, { light: string; dark: string }> = {
  fact: { light: "#d4501a", dark: "#d95926" },
  decision: { light: "#2672cc", dark: "#3987e5" },
  goal: { light: "#a97000", dark: "#c98500" },
  deadline: { light: "#c54379", dark: "#d55181" },
  preference: { light: "#4a3aa7", dark: "#9085e9" },
  lesson: { light: "#007a00", dark: "#2e9a3a" },
};

/** CSS custom property that carries the active theme's step. */
export function categoryVar(category: Category): string {
  return `var(--cat-${category})`;
}

export function isKnownCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

/** Order for display; anything unexpected from the API is appended, never dropped. */
export function orderedCategories(present: Iterable<string>): string[] {
  const seen = new Set(present);
  const known = DISPLAY_ORDER.filter((c) => seen.has(c));
  const unknown = [...seen].filter((c) => !isKnownCategory(c)).sort();
  return [...known, ...unknown];
}

export function labelFor(category: string): string {
  return isKnownCategory(category) ? CATEGORY_LABEL[category] : category;
}
