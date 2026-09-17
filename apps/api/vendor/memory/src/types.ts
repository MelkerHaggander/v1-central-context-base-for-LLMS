export const CATEGORIES = [
  "fact",
  "decision",
  "goal",
  "deadline",
  "preference",
  "lesson",
] as const;

export type Category = (typeof CATEGORIES)[number];

export type MemoryRecord = {
  id: string;
  project: string;
  category: Category;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
};

export type MemoryInput = {
  project: string;
  category: string;
  title: string;
  content: string;
};

export type SearchInput = {
  project?: string;
  category?: string;
  query?: string;
  offset?: number;
};

export type AppError = {
  error: { code: string; message: string };
};

export type Result<T> = { data: T } | AppError;
