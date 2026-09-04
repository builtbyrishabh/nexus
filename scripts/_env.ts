// Load env for standalone scripts (Next.js is not in the loop here).
// .env.local (Vercel/Neon pull) takes precedence over .env.
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });
