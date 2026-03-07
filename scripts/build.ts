import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

/**
 * Build the browser application into the dist directory.
 */
async function buildClient() {
  const rootDir = process.cwd();
  const distDir = path.join(rootDir, "dist");
  const assetsDir = path.join(distDir, "assets");

  await rm(distDir, { force: true, recursive: true });
  await mkdir(assetsDir, { recursive: true });

  const clientBuild = await build({
    entryPoints: {
      app: path.join(rootDir, "src/client/main.tsx"),
      "prefetch-worker": path.join(rootDir, "src/client/prefetch-worker.ts"),
    },
    bundle: true,
    splitting: false,
    format: "esm",
    platform: "browser",
    target: ["es2022"],
    sourcemap: true,
    outdir: assetsDir,
    entryNames: "[name]",
    loader: {
      ".css": "css",
      ".module.css": "local-css",
    },
    jsx: "automatic",
    logLevel: "info",
  });

  const cssOutput = clientBuild.outputFiles?.find((file) => file.path.endsWith(".css"));
  if (cssOutput) {
    console.info("CSS emitted to", cssOutput.path);
  }

  await Bun.write(
    path.join(distDir, "index.html"),
    Bun.file(path.join(rootDir, "public/index.html")),
  );
}

await buildClient();
