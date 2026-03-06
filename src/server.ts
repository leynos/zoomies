import path from "node:path";
import { getContentType } from "./server/contentType";

const rootDir = process.cwd();
const distDir = path.join(rootDir, "dist");

/**
 * Ensure the client bundle exists before the server accepts requests.
 */
async function ensureBuild() {
  await Bun.$`bun run build`;
}

await ensureBuild();

const server = Bun.serve({
  development: true,
  port: Number(process.env.PORT ?? "3000"),
  routes: {
    "/*": async (request) => {
      const url = new URL(request.url);
      const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
      const file = Bun.file(path.join(distDir, pathname));

      if (!(await file.exists())) {
        return new Response(Bun.file(path.join(distDir, "index.html")), {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        });
      }

      return new Response(file, {
        headers: {
          "Content-Type": getContentType(pathname),
        },
      });
    },
  },
});

console.info(`Zoomies server listening on http://localhost:${server.port}`);
