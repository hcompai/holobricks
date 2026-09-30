import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

/** Serves api/<name>.ts at /api/<name> in development, as the Vercel functions do once deployed. */
function api(): Plugin {
  return {
    name: "brickyard-api",
    configureServer(server) {
      Object.assign(process.env, loadEnv("development", process.cwd(), ""));
      server.middlewares.use(async (req, res, next) => {
        const name = req.url?.match(/^\/api\/(\w+)(?:\?|$)/)?.[1];
        if (!name) return next();
        try {
          const handler = (await server.ssrLoadModule(`/api/${name}.ts`))[req.method ?? "GET"];
          if (!handler) {
            res.statusCode = 405;
            return res.end();
          }
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk);
          const headers = Object.entries(req.headers).flatMap(([k, v]) => (v === undefined ? [] : [[k, String(v)]]));
          const request = new Request(`http://${req.headers.host}${req.url}`, {
            method: req.method,
            headers: headers as [string, string][],
            body: chunks.length ? Buffer.concat(chunks) : undefined,
          });
          const response: Response = await handler(request);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => key !== "set-cookie" && res.setHeader(key, value));
          if (response.headers.has("set-cookie")) res.setHeader("set-cookie", response.headers.getSetCookie());
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (e) {
          next(e);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), api()],
  server: {
    port: 5173,
    fs: { allow: [".."] },
  },
});
