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

export type UpdateMemoryInput = MemoryInput & {
  id: string;
  allow_project_change?: boolean;
};

export type SearchInput = {
  project?: string;
  category?: string;
  query?: string;
  offset?: number;
};

export type ContextInput = {
  prompt: string;
  project?: string;
};

export type ContextItem = {
  id: string;
  project: string;
  category: Category;
  title: string;
  snippet: string;
  updated_at: string;
  source: "user_memory";
};

export type ContextResult = {
  keywords: string[];
  project?: string;
  projects?: string[];
  items: ContextItem[];
  omitted: number;
  omitted_duplicate: number;
  omitted_capped: number;
};

export type AppError = {
  error: { code: string; message: string };
};

export type Result<T> = { data: T } | AppError;
