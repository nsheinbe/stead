/**
 * Vercel function. vercel.json rewrites every /api/* request here and the
 * original path is preserved, so Hono does the routing.
 *
 * Do not import ../server/app from a TypeScript entry. Vercel's Vite builder
 * compiles only this file and leaves `import '../server/app'` in the output;
 * Node ESM then fails with `Cannot find module '/var/task/server/app'`.
 * `npm run build` emits dist-api/handler.js with the Hono app inlined.
 */
export const config = { runtime: "nodejs" };

export { default } from "../dist-api/handler.js";
