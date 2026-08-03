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
    // Vinext keeps some lazy chunk references relative to the asset directory.
    // Make those project-site-safe too; otherwise they resolve from /assets.
    .replaceAll('"assets/', '"/shards/assets/')
    .replaceAll("'assets/", "'/shards/assets/")
    .replaceAll("/favicon.svg", "/shards/favicon.svg")
    .replaceAll("/simulation.wasm", "/shards/simulation.wasm")
    .replaceAll(/\/shards\/assets\/([A-Za-z0-9._-]+)/g, `/shards/assets/$1?v=${assetVersion}`);

  if (rewritten !== source) await writeFile(filePath, rewritten);
}
