/**
 * Vercel handler source. `vite.api.config.ts` bundles this (and the Hono app
 * it imports) into dist-api/handler.js. The function in api/index.js re-exports
 * that file so Node ESM never has to resolve an extensionless `server/app`.
 */
import { handle } from "hono/vercel";
import app from "./app";

export { app };
export default handle(app);
