/**
 * Self-host entry: serves the built SPA from dist/ and the API from the same
 * origin, so session cookies work without CORS. `npm run build && npm start`.
 */
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import app from "./app";

const server = new Hono();

server.route("/", app);
server.use("/assets/*", serveStatic({ root: "./dist" }));
server.use("/favicon.ico", serveStatic({ root: "./dist" }));
// SPA fallback: React Router owns every non-API path.
server.get("*", serveStatic({ path: "./dist/index.html" }));

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: server.fetch, port }, (info) => {
  console.log(`Stead listening on http://localhost:${info.port}`);
});
