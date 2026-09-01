/**
 * Vercel entry point. vercel.json rewrites every /api/* request here and the
 * original path is preserved, so Hono does the routing.
 */
import { handle } from "hono/vercel";
import app from "../server/app";

export const config = { runtime: "nodejs" };

export default handle(app);
