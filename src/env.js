import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

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
    /** Embedding model. Stays OpenAI for 1536-dim compatibility with the schema. */
    EMBED_MODEL: z.string().default("openai/text-embedding-3-small"),
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
    EMBED_MODEL: process.env.EMBED_MODEL,
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
