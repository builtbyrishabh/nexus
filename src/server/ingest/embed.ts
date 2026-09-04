import { embed, embedMany } from "ai";

import { env } from "~/env";

/**
 * Batch-embed chunk inputs. Values are `context_text + "\n" + text` (context_text is empty
 * in Slice 0, so effectively `embed(text)`). Routed through the AI Gateway.
 */
export async function embedTexts(values: string[]): Promise<number[][]> {
  if (values.length === 0) return [];
  const { embeddings } = await embedMany({
    model: env.EMBED_MODEL,
    values,
  });
  return embeddings;
}

/** Embed a single query for dense retrieval. */
export async function embedQuery(query: string): Promise<number[]> {
  const { embedding } = await embed({
    model: env.EMBED_MODEL,
    value: query,
  });
  return embedding;
}
