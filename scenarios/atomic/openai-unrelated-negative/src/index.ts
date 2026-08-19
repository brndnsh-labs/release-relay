import { OpenAI } from "openai";

// A same-provider negative: a maintainer utility that calls the official
// OpenAI SDK for an operation outside Release Relay's documented product
// workflow (a structured, source-grounded release draft through the
// Responses API). Embedding past changelog entries for a maintainer search
// index is real, correctly attributed OpenAI API usage that should not be
// conflated with the release-drafting call site in
// scenarios/atomic/openai-release-note-drafter. This workspace compiles
// only and is never invoked or given a real API key.

export interface ChangelogEntryEmbedding {
  sourceIdentity: string;
  embedding: readonly number[];
}

// unrelated-negative-embed-client
export async function embedChangelogEntries(
  apiKey: string,
  entries: readonly { sourceIdentity: string; text: string }[]
): Promise<ChangelogEntryEmbedding[]> {
  const client = new OpenAI({ apiKey });
  const response = await client.embeddings.create({
    model: "text-embedding-ada-002",
    input: entries.map((entry) => entry.text),
    encoding_format: "float"
  });
  return entries.map((entry, index) => {
    const embedding = response.data[index]?.embedding ?? [];
    return { sourceIdentity: entry.sourceIdentity, embedding };
  });
}
