/**
 * Vercel handler source. `vite.api.config.ts` bundles this (and the Hono app
 * it imports) into dist-api/handler.js. The function in api/index.js re-exports
 * that file so Node ESM never has to resolve an extensionless `server/app`.
 *
 * Do not use `handle()` from `hono/vercel` as the default export. That helper
 * is `(req) => app.fetch(req)` — a function that returns a Response. Vercel's
 * Node runtime treats a function default export as `(req, res) => void`,
 * ignores the Response, and the invocation times out. The Web signature is
 * `export default { fetch(request) { ... } }`.
 */
import app from "./app";

export { app };

export default {
  fetch: (request: Request): Response | Promise<Response> => app.fetch(request),
};
