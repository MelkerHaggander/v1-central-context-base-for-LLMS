import { CATEGORIES, type MemoryInput, type SearchInput } from "./types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function fail(code: string, message: string) {
  return { error: { code, message } } as const;
}

export function validateMemoryInput(input: MemoryInput) {
  const project = input.project?.trim() ?? "";
  const title = input.title?.trim() ?? "";
  const content = input.content?.trim() ?? "";
  const category = input.category?.trim() ?? "";

  if (project.length < 1 || project.length > 100) {
    return fail("INVALID_PROJECT", "project måste vara 1–100 tecken.");
  }
  if (title.length < 1 || title.length > 150) {
    return fail("INVALID_TITLE", "title måste vara 1–150 tecken.");
  }
  if (content.length < 1 || content.length > 10_000) {
    return fail("INVALID_CONTENT", "content måste vara 1–10 000 tecken.");
  }
  if (!CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
    return fail(
      "INVALID_CATEGORY",
      "category måste vara fact, decision, goal, deadline, preference eller lesson.",
    );
  }

  return {
    data: {
      project,
      category: category as MemoryInput["category"],
      title,
      content,
    },
  };
}

export function validateSearchInput(input: SearchInput) {
  const project = input.project?.trim();
  const category = input.category?.trim();
  const query = input.query?.trim();
  const offset = input.offset ?? 0;

  if (project && project.length > 100) {
    return fail("INVALID_PROJECT", "project måste vara 1–100 tecken.");
  }
  if (category && !CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
    return fail(
      "INVALID_CATEGORY",
      "category måste vara fact, decision, goal, deadline, preference eller lesson.",
    );
  }
  if (!Number.isInteger(offset) || offset < 0) {
    return fail("INVALID_OFFSET", "offset måste vara ett heltal 0 eller högre.");
  }

  return {
    data: {
      project: project || undefined,
      category: category || undefined,
      query: query || undefined,
      offset,
    },
  };
}

export function validateMemoryId(id: string) {
  if (!UUID_RE.test(id)) {
    return fail("INVALID_ID", "id måste vara ett UUID.");
  }
  return { data: id };
}
