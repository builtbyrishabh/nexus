import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * A boolean env flag. `z.coerce.boolean()` is a trap here — it makes ANY non-empty string true,
 * so `FLAG=false` would read as `true`. This treats only "true"/"1" as on, everything else off.
 * @param {string} fallback
 */
const booleanFlag = (fallback) =>
  z
    .string()
    .default(fallback)
    .transform((s) => s === "true" || s === "1");

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    DATABASE_URL: z.string().url(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    /**
     * Vercel AI Gateway key. Optional at build/typecheck time: on Vercel the gateway can
     * authenticate via the OIDC token, and it is only strictly required to actually run
     * ingestion (embeddings) and generation locally.
     */
    AI_GATEWAY_API_KEY: z.string().optional(),
    /** Generation model routed through the AI Gateway (provider/model). */
    GEN_MODEL: z.string().default("zai/glm-5.3-flash"),
    /**
     * Contextual-Retrieval model: writes the short "situate this chunk in the whole video"
     * blurb during ingestion. Deliberately its own knob (cheap/swappable) — it runs once per
     * chunk offline and never touches the query path.
     */
    CONTEXT_MODEL: z.string().default("zai/glm-5.3-flash"),
    /** Embedding model. Stays OpenAI for 1536-dim compatibility with the schema. */
    EMBED_MODEL: z.string().default("openai/text-embedding-3-small"),
    /**
     * Cross-encoder reranker, routed through the AI Gateway. Slots into retrieve() between RRF
     * fusion and neighbor expansion. Provider is swappable (Cohere/Voyage/…) via this one knob.
     */
    RERANK_MODEL: z.string().default("cohere/rerank-v3.5"),
    /**
     * Rerank is off by default: it is the *measured* add-on (docs/DESIGN.md §7), so retrieve()
     * behaves exactly as Slice 1 until this flips on. The eval harness overrides it per-run to
     * measure the lift rather than assert it.
     */
    RERANK_ENABLED: booleanFlag("false"),
    /** LLM judge for the eval scorers (Faithfulness/Answer-Relevancy/Context-Precision). */
    EVAL_MODEL: z.string().default("zai/glm-5.3-flash"),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    // NEXT_PUBLIC_CLIENTVAR: z.string(),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
    GEN_MODEL: process.env.GEN_MODEL,
    CONTEXT_MODEL: process.env.CONTEXT_MODEL,
    EMBED_MODEL: process.env.EMBED_MODEL,
    RERANK_MODEL: process.env.RERANK_MODEL,
    RERANK_ENABLED: process.env.RERANK_ENABLED,
    EVAL_MODEL: process.env.EVAL_MODEL,
    // NEXT_PUBLIC_CLIENTVAR: process.env.NEXT_PUBLIC_CLIENTVAR,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});
