import path from "node:path";
import devServer from "@hono/vite-dev-server";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // The API runs inside the dev server and reads process.env, so hydrate it
  // from .env the same way Vite hydrates import.meta.env.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));

  return {
    plugins: [
      react(),
      devServer({
        entry: "server/app.ts",
        // Everything that is not /api/* stays with Vite.
        exclude: [/^(?!\/api\/).*/],
        injectClientScript: false,
      }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
        "@server": path.resolve(__dirname, "server"),
      },
    },
  };
});
