import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/** Serves api/*.ts in `npm run dev` the way Vercel does in production. */
function devApi(): Plugin {
  return {
    name: "dev-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const m = req.url?.match(/^\/api\/([\w-]+)/);
        if (!m) return next();
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const raw = Buffer.concat(chunks).toString("utf8");
        const vreq = Object.assign(req, { body: raw ? JSON.parse(raw) : undefined });
        const vres = Object.assign(res, {
          status(code: number) {
            res.statusCode = code;
            return vres;
          },
          json(body: unknown) {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(body));
            return vres;
          },
        });
        try {
          const mod = await server.ssrLoadModule(`/api/${m[1]}.ts`);
          await mod.default(vreq, vres);
        } catch (e) {
          console.error(e);
          vres.status(500).json({ error: String(e) });
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Make server-side keys from .env.local visible to the dev API handler
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));
  return { plugins: [react(), tailwindcss(), devApi()] };
});
