/**
 * Vercel function. vercel.json rewrites every /api/* request here and the
 * original path is preserved, so Hono does the routing.
 *
 * Do not import ../server/app from a TypeScript entry. Vercel's Vite builder
 * compiles only this file and leaves `import '../server/app'` in the output;
 * Node ESM then fails with `Cannot find module '/var/task/server/app'`.
 * `npm run build` emits dist-api/handler.js with the Hono app inlined.
 *
 * The default export must be `{ fetch }`, not a function. A function default
 * is treated as the Node (req, res) signature; a returned Response is ignored
 * and the invocation times out (FUNCTION_INVOCATION_TIMEOUT).
 */
import { app } from "../dist-api/handler.js";

export const config = { runtime: "nodejs" };

export default {
  fetch(request) {
    return app.fetch(request);
  },
};
