import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { rewriteProjectSiteAssetReferences } from "./github-pages-assets.mjs";

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
  const rewritten = rewriteProjectSiteAssetReferences(source, assetVersion);

  if (rewritten !== source) await writeFile(filePath, rewritten);
}

// The ripple prototype is intentionally a standalone static surface. Its
// canvas script does not need the app router, and leaving the hydration shell
// in place makes GitHub Pages try to reconcile the project-site path.
const rippleRouteDirectory = path.join(outputRoot, "ripples");
await mkdir(rippleRouteDirectory, { recursive: true });
const standaloneRippleHtml = await readFile(path.resolve("scripts/ripples-standalone.html"), "utf8");
await writeFile(path.join(rippleRouteDirectory, "index.html"), standaloneRippleHtml);
