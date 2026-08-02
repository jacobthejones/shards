import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const outputRoot = path.resolve("dist/client");
const textExtensions = new Set([".css", ".html", ".js", ".json", ".rsc"]);

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
    .replaceAll("/favicon.svg", "/shards/favicon.svg");

  if (rewritten !== source) await writeFile(filePath, rewritten);
}
