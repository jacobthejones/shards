import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const outputRoot = path.resolve("dist/client");
const textExtensions = new Set([".css", ".html", ".js", ".json", ".rsc"]);
const assetVersion = (process.env.GITHUB_SHA ?? "local").slice(0, 12);

const collectFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(entryPath));
    } else if (textExtensions.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files;
};

for (const filePath of await collectFiles(outputRoot)) {
  const source = await readFile(filePath, "utf8");
  const rewritten = source
    .replaceAll("/assets/", "/shards/assets/")
    // Vinext prepends a slash when resolving these dependency-map entries.
    // Keep the project prefix slash-free here, or they become //shards/... URLs.
    .replaceAll('"assets/', '"shards/assets/')
    .replaceAll("'assets/", "'shards/assets/")
    .replaceAll("/favicon.svg", "/shards/favicon.svg")
    .replaceAll("/simulation.wasm", "/shards/simulation.wasm")
    .replaceAll(/\/shards\/assets\/([A-Za-z0-9._-]+)/g, `/shards/assets/$1?v=${assetVersion}`);

  if (rewritten !== source) await writeFile(filePath, rewritten);
}

// The ripple prototype is intentionally a standalone static surface. Its
// canvas script does not need the app router, and leaving the hydration shell
// in place makes GitHub Pages try to reconcile the project-site path.
const rippleRoutePath = path.join(outputRoot, "ripples", "index.html");
const rippleRouteHtml = await readFile(rippleRoutePath, "utf8");
const mainStart = rippleRouteHtml.indexOf("<main ");
const mainEnd = rippleRouteHtml.indexOf("</main>", mainStart);
if (mainStart === -1 || mainEnd === -1) {
  throw new Error("Could not find the ripple prototype markup in the exported route.");
}
const rippleMain = rippleRouteHtml.slice(mainStart, mainEnd + "</main>".length);
const standaloneRippleHtml = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>ripples — after the field</title><meta name="description" content="A quiet wavefront study after the shards have gone still."/><link rel="shortcut icon" href="/shards/favicon.svg"/><link rel="icon" href="/shards/favicon.svg"/></head><body>${rippleMain}</body></html>`;
await writeFile(rippleRoutePath, standaloneRippleHtml);
