import type { EmbeddingClient, FormulateInput, MemoryDraft, MemoryFormulator } from "@v1/memory";

export const EMBEDDING_DIMENSIONS = 3072;

const RECORD_TOOL = {
  name: "record_memories",
  description: "Extract durable memories. Return an empty list when nothing should be saved.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      memories: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            space: { type: "string", enum: ["personal", "shared"] },
            project: { type: "string" },
            category: {
              type: "string",
              enum: ["fact", "decision", "goal", "deadline", "preference", "lesson"],
            },
            title: { type: "string" },
            content: { type: "string" },
          },
          required: ["space", "project", "category", "title", "content"],
        },
      },
    },
    required: ["memories"],
  },
} as const;

export function embeddingRequest(model: string, text: string) {
  return {
    model,
    input: text,
    dimensions: EMBEDDING_DIMENSIONS,
  };
}

export function formulatorRequest(model: string, input: FormulateInput) {
  return {
    model,
    max_tokens: 4096,
    temperature: 0,
    thinking: { type: "disabled" as const },
    system: [
      "Extract only durable memories from the user text.",
      "Use personal unless the text explicitly asks for shared.",
      "Never send a raw space id.",
      "Reuse an existing project, category and title when it is the same subject.",
      "Do not change category or project on an existing subject.",
      "Do not store secrets or a secret filter the user rejected.",
      "An empty list is valid.",
      "Return at most 8 memories.",
    ].join(" "),
    messages: [
      {
        role: "user" as const,
        content: JSON.stringify({
          source: input.source,
          text: input.text,
          project: input.project ?? null,
          prompt: input.prompt ?? null,
          existing: input.existing,
        }),
      },
    ],
    tools: [RECORD_TOOL],
    tool_choice: { type: "tool" as const, name: "record_memories" },
  };
}

export function createEmbeddingClient(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): EmbeddingClient | null {
  const key = env.OPENAI_API_KEY?.trim();
  const model = env.MEMORY_EMBEDDING_MODEL?.trim();
  if (!key || !model) return null;
  return {
    dimensions: EMBEDDING_DIMENSIONS,
    async embed(text: string) {
      const response = await fetchImpl("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(embeddingRequest(model, text)),
      });
      if (!response.ok) throw new Error(`embedding failed: ${response.status}`);
      const json = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
      const vector = json.data?.[0]?.embedding;
      if (!Array.isArray(vector)) throw new Error("embedding missing");
      return vector;
    },
  };
}

export function createFormulatorClient(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): MemoryFormulator | null {
  const key = env.ANTHROPIC_API_KEY?.trim();
  const model = env.MEMORY_FORMULATOR_MODEL?.trim();
  if (!key || !model) return null;
  return {
    async formulate(input) {
      const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(formulatorRequest(model, input)),
      });
      if (!response.ok) throw new Error(`formulate failed: ${response.status}`);
      const json = (await response.json()) as {
        content?: Array<{ type?: string; name?: string; input?: { memories?: MemoryDraft[] } }>;
      };
      const tool = json.content?.find((block) => block.type === "tool_use" && block.name === "record_memories");
      return tool?.input?.memories ?? [];
    },
  };
}

export function createBrainClients(env: Record<string, string | undefined> = process.env) {
  return {
    embedding: createEmbeddingClient(env) ?? undefined,
    formulator: createFormulatorClient(env) ?? undefined,
  };
}
