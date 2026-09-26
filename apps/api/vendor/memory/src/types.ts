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

export type SpaceKind = "personal" | "shared";

export type MemorySource = "dashboard" | "brain";

export type WrittenMemory = {
  id: string;
  project: string;
  category: Category;
  title: string;
  space: SpaceKind;
  space_id: string;
};

export type ContextResult = {
  keywords: string[];
  project?: string;
  projects?: string[];
  items: ContextItem[];
  omitted: number;
  omitted_duplicate: number;
  omitted_capped: number;
  written: WrittenMemory[];
};

export type MemoryVersion = {
  version_number: number;
  space_id: string | null;
  project: string;
  category: Category;
  title: string;
  content: string;
  source: MemorySource | null;
  created_at: string;
};

export type MemoryIdentity = {
  project: string;
  category: Category;
  title: string;
  updated_at: string;
};

export type MemoryDraft = {
  space?: string;
  project?: string;
  category?: string;
  title?: string;
  content?: string;
};

export type EmbeddingClient = {
  dimensions: number;
  embed(text: string): Promise<number[]>;
};

export type FormulateInput = {
  source: "get_context" | "save_memory";
  text: string;
  project?: string;
  prompt?: string;
  existing: MemoryIdentity[];
};

export type MemoryFormulator = {
  formulate(input: FormulateInput): Promise<MemoryDraft[]>;
};

export type SpaceAccess = {
  readableSpaceIds(userId: string): Promise<string[]>;
  spaceFor(userId: string, kind: SpaceKind): Promise<string | null>;
  isMember(userId: string, spaceId: string): Promise<boolean>;
};

export type BrainDeps = {
  embedding?: EmbeddingClient;
  formulator?: MemoryFormulator;
  spaces?: SpaceAccess;
};

export type SaveBriefInput = {
  brief?: string;
  project?: string;
  prompt?: string;
  category?: string;
  title?: string;
  content?: string;
};

export type SaveBriefResult = {
  items: WrittenMemory[];
};

export type SubjectWrite = {
  spaceId: string;
  project: string;
  category: string;
  title: string;
  content: string;
  source: MemorySource;
};

export type AppError = {
  error: { code: string; message: string };
};

export type Result<T> = { data: T } | AppError;
